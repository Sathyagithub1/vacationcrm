/**
 * Customer memory — persistent facts, preferences, and summaries.
 *
 * When a customer returns days or weeks later, agents (human or AI) see a
 * structured context digest built from prior conversations:
 *   - FACT: factual information about the customer (e.g., "Prefers window seats")
 *   - PREFERENCE: travel preferences (e.g., "Budget ₹80k for family of 4")
 *   - SUMMARY: auto-generated summary of a closed conversation
 *
 * Deduplication:
 *   The CustomerMemory table has a @@unique([tenantId, customerId, kind, content])
 *   constraint so the same fact is never stored twice.  appendMemory() uses
 *   upsert and silently ignores duplicates.
 *
 * Conversation summarization:
 *   summarizeConversation() calls the tenant's active AI provider with the
 *   last N messages, parses a plain-text summary, and stores it as a SUMMARY
 *   memory record.  On AI failure it logs a warning and returns an empty string
 *   rather than crashing the close flow.
 */

import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
// CustomerMemoryKind is a new enum added in 6b migration — use string literal type
// until `prisma generate` is re-run after migration.
import type { Message } from "@prisma/client";

// New enum value until Prisma regenerates
type CustomerMemoryKind = "FACT" | "PREFERENCE" | "SUMMARY";

// Helper cast for new model accessors not yet in generated client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyTenantDb = (db: unknown) => db as any;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerContext {
  summary: string | null;
  facts: string[];
  preferences: string[];
  recentMessages: Pick<Message, "id" | "senderType" | "content" | "createdAt">[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approximate token budget for getCustomerContext() */
const DEFAULT_LIMIT_TOKENS = 2000;
const CHARS_PER_TOKEN = 4; // conservative estimate
const RECENT_MESSAGE_COUNT = 10;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a memory item for a customer.
 * Silently dedupes (upsert on unique key) — safe to call multiple times with
 * the same content.
 */
export async function appendMemory(
  tenantId: string,
  customerId: string,
  kind: CustomerMemoryKind,
  content: string,
  sourceMessageId?: string
): Promise<void> {
  try {
    await anyPrisma.customerMemory.upsert({
      where: {
        tenantId_customerId_kind_content: {
          tenantId,
          customerId,
          kind,
          content,
        },
      },
      update: {}, // already exists — no-op
      create: {
        tenantId,
        customerId,
        kind,
        content,
        sourceMessageId: sourceMessageId ?? null,
      },
    });
  } catch (err) {
    // Swallow uniqueness race — the record will already be there
    console.warn(`[CustomerMemory] appendMemory upsert warn (tenantId=${tenantId}):`, err);
  }
}

/**
 * Build the context digest for a customer to inject into an AI prompt or
 * agent context panel.
 *
 * @param customerId    The customer whose memory to retrieve.
 * @param limitTokens   Approximate character budget (default 2000 tokens ≈ 8000 chars).
 */
export async function getCustomerContext(
  customerId: string,
  limitTokens = DEFAULT_LIMIT_TOKENS
): Promise<CustomerContext> {
  const charBudget = limitTokens * CHARS_PER_TOKEN;

  // Look up tenant via customer record
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { tenantId: true },
  });
  if (!customer) throw new Error(`Customer not found: ${customerId}`);

  const tenantId = customer.tenantId;
  const db = tenantPrisma(tenantId);

  // Load memories grouped by kind
  const memories = await anyTenantDb(db).customerMemory.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    select: { kind: true, content: true },
  }) as { kind: CustomerMemoryKind; content: string }[];

  const latestSummary =
    memories.find((m: { kind: string; content: string }) => m.kind === "SUMMARY")?.content ?? null;
  const facts = memories
    .filter((m: { kind: string; content: string }) => m.kind === "FACT")
    .map((m: { kind: string; content: string }) => m.content);
  const preferences = memories
    .filter((m: { kind: string; content: string }) => m.kind === "PREFERENCE")
    .map((m: { kind: string; content: string }) => m.content);

  // Load recent messages from the customer's most recent conversation
  const recentConv = await db.conversation.findFirst({
    where: { customerId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  let recentMessages: Pick<Message, "id" | "senderType" | "content" | "createdAt">[] = [];

  if (recentConv) {
    recentMessages = await db.message.findMany({
      where: { conversationId: recentConv.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_COUNT,
      select: { id: true, senderType: true, content: true, createdAt: true },
    });
    recentMessages = recentMessages.reverse();
  }

  // Trim to token budget if needed
  let usedChars = 0;
  const trimmedMessages = recentMessages.filter((m) => {
    usedChars += m.content.length;
    return usedChars <= charBudget;
  });

  return {
    summary: latestSummary,
    facts,
    preferences,
    recentMessages: trimmedMessages,
  };
}

/**
 * Generate a 2–3 sentence summary for a conversation and store it as a
 * SUMMARY memory for the customer.
 *
 * Calls the tenant's active AI provider.  Fail-soft: on any error, logs a
 * warning with tenantId and returns an empty string so the conversation close
 * flow is not blocked.
 *
 * @param conversationId  The conversation to summarise.
 * @returns               The generated summary, or "" on failure.
 */
export async function summarizeConversation(conversationId: string): Promise<string> {
  // Look up conversation + tenant
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, customerId: true },
  });
  if (!conv || !conv.customerId) return "";

  const tenantId = conv.tenantId;
  const db = tenantPrisma(tenantId);

  // Load last 20 messages for summarisation
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { senderType: true, content: true },
  });

  if (messages.length === 0) return "";

  const transcript = messages
    .map(
      (m: { senderType: string; content: string }) =>
        `${m.senderType === "CUSTOMER" ? "Customer" : "Agent"}: ${m.content}`
    )
    .join("\n");

  const prompt =
    `Summarize the following travel inquiry conversation in 2-3 sentences. ` +
    `Focus on the customer's travel goals, key preferences mentioned, and any outcomes or next steps.\n\n` +
    `CONVERSATION:\n${transcript}\n\nSUMMARY:`;

  try {
    const { getAIProvider } = await import("@/modules/ai/provider");
    const provider = await getAIProvider(tenantId);
    const summary = (await provider.complete(prompt)).trim();

    if (summary) {
      await appendMemory(tenantId, conv.customerId, "SUMMARY", summary);

      // Also store on the Conversation row
      await anyPrisma.conversation.update({
        where: { id: conversationId },
        data: { summary },
      });
    }

    return summary;
  } catch (err) {
    console.warn(
      `[CustomerMemory] summarizeConversation failed (tenantId=${tenantId}, convId=${conversationId}):`,
      err instanceof Error ? err.message : err
    );
    return "";
  }
}

/**
 * Close a conversation: sets status to CLOSED, stamps closedAt, then
 * fires summarizeConversation asynchronously (does not block the caller).
 */
export async function closeConversationWithMemory(
  tenantId: string,
  conversationId: string
): Promise<void> {
  const db = tenantPrisma(tenantId);

  await db.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  // Fire-and-forget summarisation
  void summarizeConversation(conversationId).catch((err) => {
    console.warn(
      `[CustomerMemory] post-close summarisation error (tenantId=${tenantId}):`,
      err instanceof Error ? err.message : err
    );
  });
}
