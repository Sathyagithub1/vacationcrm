/**
 * src/modules/voice/agent.ts
 *
 * Voice agent dialogue engine (Phase 6d).
 *
 * Processes one customer utterance turn in an active voice call using the
 * tenant's configured AI provider.  Persists both the customer utterance and
 * the bot response as VoiceCallSegment rows, and mirrors them into the linked
 * Conversation/Message thread via `mirrorSegmentToMessage`.
 *
 * nextAction values:
 *   CONTINUE  — continue the IVR conversation
 *   TRANSFER  — transfer the call to a human agent
 *   CALLBACK  — schedule a callback and end the call
 *   END       — end the call (booking confirmed, query resolved, etc.)
 *
 * AI response format (the model must include one of these lines):
 *   ACTION: CONTINUE
 *   ACTION: TRANSFER
 *   ACTION: CALLBACK
 *   ACTION: END
 *
 * Fail-soft:
 *   On any AI provider error, logs a warning with tenantId and returns a
 *   polite apology message with nextAction = "END" so the IVR is not left
 *   hanging with silence.
 */

import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/modules/ai/provider";
import { getCustomerContext } from "@/modules/memory/customer-memory";
import { mirrorSegmentToMessage } from "./conversation-sync";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceAgentNextAction = "CONTINUE" | "TRANSFER" | "CALLBACK" | "END";

export interface VoiceAgentTurnResult {
  responseText: string;
  nextAction: VoiceAgentNextAction;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum segments to load as history (keeps prompt size bounded). */
const MAX_HISTORY_SEGMENTS = 10;

const VALID_ACTIONS = new Set<VoiceAgentNextAction>([
  "CONTINUE",
  "TRANSFER",
  "CALLBACK",
  "END",
]);

const APOLOGY_RESPONSE = "I'm sorry, I'm having trouble understanding. Let me transfer you to an agent.";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process one turn in the voice agent dialogue.
 *
 * @param voiceCallId          The active VoiceCall record.
 * @param customerUtterance    The customer's transcribed speech for this turn.
 * @returns                    { responseText, nextAction }
 */
export async function runVoiceAgentTurn(
  voiceCallId: string,
  customerUtterance: string,
): Promise<VoiceAgentTurnResult> {
  // ── 1. Load VoiceCall + recent segments ──────────────────────────────────
  // New models not yet in generated Prisma client — remove cast after migrate+generate
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyPrisma = prisma as any;

  const voiceCall = await anyPrisma.voiceCall.findUnique({
    where: { id: voiceCallId },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      leadId: true,
      language: true,
      segments: {
        orderBy: { createdAt: "desc" },
        take: MAX_HISTORY_SEGMENTS,
        select: {
          id: true,
          speaker: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });

  if (!voiceCall) {
    throw new Error(`[VoiceAgent] VoiceCall not found: ${voiceCallId}`);
  }

  const { tenantId, customerId, language } = voiceCall as {
    tenantId: string;
    customerId: string | null;
    language: string | null;
    segments: Array<{ id: string; speaker: string; content: string; createdAt: Date }>;
  };

  // Segments come back newest-first; reverse for chronological order.
  const recentSegments = (
    (voiceCall as { segments: Array<{ id: string; speaker: string; content: string; createdAt: Date }> })
      .segments
  ).slice().reverse();

  // ── 2. Load Customer memory context ──────────────────────────────────────
  let customerContext: Awaited<ReturnType<typeof getCustomerContext>> | null = null;
  if (customerId) {
    try {
      customerContext = await getCustomerContext(customerId);
    } catch (err) {
      console.warn(
        `[VoiceAgent] Could not load customer context for customerId=${customerId} ` +
          `(tenantId=${tenantId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── 3. Persist customer utterance ──────────────────────────────────────
  // Approximate startMs: time elapsed from call start to now (ms).
  // For v1 we use 0 as a safe default (actual offset tracking deferred).
  const lastEndMs = recentSegments.length > 0 ? recentSegments.length * 3000 : 0;

  const customerSegment = await anyPrisma.voiceCallSegment.create({
    data: {
      voiceCallId,
      speaker: "CUSTOMER",
      content: customerUtterance,
      startMs: Math.max(0, lastEndMs),
    },
    select: { id: true },
  });

  // Mirror into conversation thread (fire-and-forget, non-blocking)
  void mirrorSegmentToMessage(customerSegment.id as string).catch((err) => {
    console.warn(
      `[VoiceAgent] mirrorSegmentToMessage failed for segment ${String(customerSegment.id)} ` +
        `(tenantId=${tenantId}):`,
      err instanceof Error ? err.message : err,
    );
  });

  // ── 4. Build prompt ───────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { voiceAgentSystemPrompt: true, name: true },
  });

  const systemPrompt =
    tenant?.voiceAgentSystemPrompt ??
    `You are a helpful voice assistant for ${tenant?.name ?? "a travel company"}. ` +
      `Help customers with their travel inquiries. Be concise — responses will be spoken aloud. ` +
      `End every response with one of these lines: ACTION: CONTINUE, ACTION: TRANSFER, ACTION: CALLBACK, or ACTION: END`;

  const contextBlock = buildContextBlock(customerContext);
  const historyBlock = buildHistoryBlock(recentSegments);
  const callLanguage = language ?? "en-IN";

  const prompt =
    `${systemPrompt}\n\n` +
    (contextBlock ? `CUSTOMER MEMORY:\n${contextBlock}\n\n` : "") +
    `CALL LANGUAGE: ${callLanguage}\n\n` +
    (historyBlock ? `CONVERSATION HISTORY:\n${historyBlock}\n\n` : "") +
    `CUSTOMER: ${customerUtterance}\n\n` +
    `ASSISTANT:`;

  // ── 5. Call AI provider ───────────────────────────────────────────────────
  let rawResponse: string;
  try {
    const ai = await getAIProvider(tenantId);
    rawResponse = await ai.complete(prompt);
  } catch (err) {
    console.warn(
      `[VoiceAgent] AI provider error for tenantId=${tenantId}, ` +
        `voiceCallId=${voiceCallId}:`,
      err instanceof Error ? err.message : err,
    );
    // Fail-soft: persist apology as bot segment and return END action
    await persistBotSegment(anyPrisma, voiceCallId, APOLOGY_RESPONSE);
    return { responseText: APOLOGY_RESPONSE, nextAction: "END" };
  }

  // ── 6. Parse ACTION line ──────────────────────────────────────────────────
  const { responseText, nextAction } = parseAIResponse(rawResponse);

  // ── 7. Persist bot response ───────────────────────────────────────────────
  const botSegment = await persistBotSegment(anyPrisma, voiceCallId, responseText);

  void mirrorSegmentToMessage(botSegment.id as string).catch((err) => {
    console.warn(
      `[VoiceAgent] mirrorSegmentToMessage failed for bot segment ${String(botSegment.id)} ` +
        `(tenantId=${tenantId}):`,
      err instanceof Error ? err.message : err,
    );
  });

  // ── 8. Create Callback if requested ──────────────────────────────────────
  if (nextAction === "CALLBACK") {
    await createCallbackFromVoiceCall(anyPrisma, voiceCall as {
      tenantId: string;
      leadId: string | null;
    });
  }

  return { responseText, nextAction };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildContextBlock(
  ctx: Awaited<ReturnType<typeof getCustomerContext>> | null,
): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.summary) parts.push(`Summary: ${ctx.summary}`);
  if (ctx.facts.length > 0) parts.push(`Facts: ${ctx.facts.join("; ")}`);
  if (ctx.preferences.length > 0) parts.push(`Preferences: ${ctx.preferences.join("; ")}`);
  return parts.join("\n");
}

function buildHistoryBlock(
  segments: Array<{ speaker: string; content: string }>,
): string {
  return segments
    .map((s) => `${s.speaker === "CUSTOMER" ? "Customer" : "Assistant"}: ${s.content}`)
    .join("\n");
}

function parseAIResponse(raw: string): {
  responseText: string;
  nextAction: VoiceAgentNextAction;
} {
  const lines = raw.trim().split("\n");
  let nextAction: VoiceAgentNextAction = "CONTINUE";

  const filteredLines = lines.filter((line) => {
    const upper = line.trim().toUpperCase();
    if (upper.startsWith("ACTION:")) {
      const candidate = upper.replace("ACTION:", "").trim() as VoiceAgentNextAction;
      if (VALID_ACTIONS.has(candidate)) {
        nextAction = candidate;
      }
      return false; // Remove the ACTION line from responseText
    }
    return true;
  });

  const responseText = filteredLines.join("\n").trim() || APOLOGY_RESPONSE;
  return { responseText, nextAction };
}

async function persistBotSegment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyPrisma: any,
  voiceCallId: string,
  content: string,
): Promise<{ id: string }> {
  return anyPrisma.voiceCallSegment.create({
    data: {
      voiceCallId,
      speaker: "BOT",
      content,
      startMs: 0,
    },
    select: { id: true },
  }) as Promise<{ id: string }>;
}

async function createCallbackFromVoiceCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyPrisma: any,
  voiceCall: { tenantId: string; leadId: string | null },
): Promise<void> {
  if (!voiceCall.leadId) {
    console.warn(
      `[VoiceAgent] CALLBACK requested but no leadId on voiceCall ` +
        `(tenantId=${voiceCall.tenantId}). Skipping Callback creation.`,
    );
    return;
  }

  try {
    // Load lead's department for the Callback record (required FK)
    const lead = await anyPrisma.lead.findUnique({
      where: { id: voiceCall.leadId },
      select: { departmentId: true, tenantId: true },
    }) as { departmentId: string | null; tenantId: string } | null;

    if (!lead?.departmentId) {
      console.warn(
        `[VoiceAgent] Lead ${voiceCall.leadId} has no departmentId; cannot create Callback`,
      );
      return;
    }

    // Schedule callback 1 hour from now
    const preferredTime = new Date(Date.now() + 60 * 60 * 1000);

    await anyPrisma.callback.create({
      data: {
        tenantId: voiceCall.tenantId,
        leadId: voiceCall.leadId,
        departmentId: lead.departmentId,
        preferredTime,
        status: "SCHEDULED",
        notes: "Scheduled by voice agent (caller requested callback)",
      },
    });
  } catch (err) {
    console.warn(
      `[VoiceAgent] Failed to create Callback for lead ${voiceCall.leadId} ` +
        `(tenantId=${voiceCall.tenantId}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
