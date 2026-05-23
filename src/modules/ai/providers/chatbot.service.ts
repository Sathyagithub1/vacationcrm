/**
 * Chatbot service — thin orchestration layer called by channel-manager
 * when an inbound message is routed to AI.
 *
 * Delegates to the existing processAIMessage service which handles:
 *  - Provider selection, system prompt building, knowledge context
 *  - Agentic tool-call loop
 *  - Persisting the bot reply as a Message record
 *  - Publishing WebSocket events
 *  - Updating AIConversation token/cost counters
 *
 * After the AI reply is generated it dispatches the reply outbound via
 * the message dispatcher so the customer receives it on their channel.
 */

import { tenantPrisma } from "@/lib/prisma";
import { processAIMessage } from "@/modules/ai/ai-chat.service";

interface HandleAIResponseParams {
  tenantId: string;
  conversationId: string;
  customerId: string;
  userMessage: string;
}

export async function handleAIResponse(params: HandleAIResponseParams): Promise<void> {
  const { tenantId, conversationId, customerId, userMessage } = params;
  const db = tenantPrisma(tenantId);

  // Resolve the department for system prompt building
  // Prefer the department from the lead linked to this conversation;
  // fall back to the first department configured for this tenant.
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: { lead: { select: { departmentId: true } } },
  });

  if (!conversation) return;

  let departmentId: string | null = conversation.lead?.departmentId ?? null;

  if (!departmentId) {
    const dept = await db.department.findFirst({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    departmentId = dept?.id ?? null;
  }

  if (!departmentId) {
    console.warn("[ChatbotService] No department found for tenant", tenantId, "— skipping AI response");
    return;
  }

  let aiResponse: string;
  let handoff: boolean;

  try {
    const result = await processAIMessage({
      db,
      tenantId,
      conversationId,
      departmentId,
      customerMessage: userMessage,
      customerId,
    });
    aiResponse = result.response;
    handoff = result.handoff;
  } catch (err) {
    console.error("[ChatbotService] processAIMessage error:", err instanceof Error ? err.message : err);
    return;
  }

  if (!aiResponse.trim()) return;

  // Dispatch the bot reply outbound to the customer's channel
  // Only dispatch if the conversation was not handed off (human agents reply manually)
  if (!handoff) {
    try {
      const { dispatchMessage } = await import("@/modules/channels/message-dispatcher.service");
      await dispatchMessage(tenantId, conversationId, aiResponse, "TEXT");
    } catch (err) {
      console.error(
        "[ChatbotService] dispatchMessage error:",
        err instanceof Error ? err.message : err
      );
    }
  }
}
