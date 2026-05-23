import { tenantPrisma } from "@/lib/prisma";
import { matchOrCreateCustomer } from "./customer-matcher.service";
import { shouldRouteToAI } from "@/modules/ai/ai-router.service";
import type { InboundMessage } from "./adapters/adapter.interface";
import type { ConversationChannel, MessageType } from "@prisma/client";

type TenantDb = ReturnType<typeof tenantPrisma>;

/**
 * Handles a fully-parsed inbound message for a given tenant.
 *
 * Responsibilities:
 *  1. Match or create customer.
 *  2. Find or create conversation (open, same channel).
 *  3. Persist the inbound Message record.
 *  4. Decide AI vs. human routing.
 *  5. If AI active — kick off AI response (fire-and-forget to avoid blocking webhook).
 *  6. Notify assigned agent if routed to human.
 */
export async function handleInboundMessage(
  tenantId: string,
  channel: ConversationChannel,
  inbound: InboundMessage
): Promise<void> {
  const db: TenantDb = tenantPrisma(tenantId);

  // ── 1. Match or create customer ───────────────────────────────────────────
  const customer = await matchOrCreateCustomer(
    db,
    tenantId,
    channel,
    inbound.senderExternalId,
    inbound.senderName
  );

  // ── 2. Find or create an open conversation for this customer+channel ──────
  let conversation = await db.conversation.findFirst({
    where: {
      customerId: customer.id,
      channel,
      status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] },
    },
    orderBy: { startedAt: "desc" },
  });

  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        tenantId,
        customerId: customer.id,
        channel,
        status: "ACTIVE",
        leadId: null,
      },
    });
  }

  // ── 3. Persist the inbound message ────────────────────────────────────────
  const safeMessageType = toMessageType(inbound.messageType);

  await db.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      senderType: "CUSTOMER",
      senderId: customer.id,
      content: inbound.content || "",
      messageType: safeMessageType,
      fileUrl: inbound.fileUrl ?? null,
    },
  });

  // ── 4. Route: AI or human? ────────────────────────────────────────────────
  const routeDecision = shouldRouteToAI(inbound.content, conversation.status);

  if (routeDecision.route === "ai") {
    // Check whether this tenant has an active AI provider configured
    const aiProvider = await db.aIProvider.findFirst({
      where: { isActive: true },
    });

    if (aiProvider) {
      // Fire AI processing asynchronously — we do not await so the webhook
      // can return 200 quickly. Errors are swallowed intentionally here;
      // the AI layer has its own retry/logging.
      void triggerAIResponse(tenantId, conversation.id, customer.id, inbound.content).catch(
        (err: unknown) => {
          console.error(
            "[ChannelManager] AI response error:",
            err instanceof Error ? err.message : err
          );
        }
      );
      return;
    }
    // No AI provider configured — fall through to human queue
  }

  // ── 5. Queue for human agent (update conversation if needed) ─────────────
  if (conversation.status !== "HUMAN_TAKEOVER") {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { status: "HUMAN_TAKEOVER" },
    });
  }

  // Notify the assigned agent (if any) about the new message
  if (conversation.assignedAgentId) {
    await db.notification.create({
      data: {
        tenantId,
        userId: conversation.assignedAgentId,
        type: "NEW_MESSAGE",
        title: "New message",
        body: `${customer.name} sent a message via ${channel}`,
        data: { conversationId: conversation.id, customerId: customer.id },
      },
    });
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toMessageType(raw: string): MessageType {
  const valid: MessageType[] = ["TEXT", "IMAGE", "FILE", "AUDIO", "VIDEO", "LOCATION", "TEMPLATE"];
  const upper = raw.toUpperCase() as MessageType;
  return valid.includes(upper) ? upper : "TEXT";
}

/**
 * Lazy-imports the AI chatbot service to avoid circular deps at module load time.
 * The chatbot service is responsible for building context, calling the provider,
 * persisting the reply, and dispatching it outbound.
 */
async function triggerAIResponse(
  tenantId: string,
  conversationId: string,
  customerId: string,
  userMessage: string
): Promise<void> {
  const { handleAIResponse } = await import("@/modules/ai/providers/chatbot.service");
  await handleAIResponse({ tenantId, conversationId, customerId, userMessage });
}
