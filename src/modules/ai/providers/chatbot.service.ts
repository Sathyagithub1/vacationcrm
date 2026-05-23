/**
 * Chatbot service — orchestrates the full AI response cycle for an inbound
 * channel message. Called by channel-manager after routing decides "ai".
 *
 * Responsibilities:
 *  1. Load the active AI provider for the tenant.
 *  2. Build conversation history as chat messages.
 *  3. Retrieve the relevant system prompt + knowledge-base context.
 *  4. Call the AI provider.
 *  5. Persist the AI reply as a Message (senderType BOT).
 *  6. Dispatch the reply outbound via the message dispatcher.
 *  7. Record AI conversation stats.
 */

import { tenantPrisma } from "@/lib/prisma";
import { createProvider } from "./index";
import { buildSystemPrompt } from "@/modules/ai/context-builder.service";

interface HandleAIResponseParams {
  tenantId: string;
  conversationId: string;
  customerId: string;
  userMessage: string;
}

export async function handleAIResponse(params: HandleAIResponseParams): Promise<void> {
  const { tenantId, conversationId, customerId, userMessage } = params;
  const db = tenantPrisma(tenantId);

  // Load active AI provider
  const providerRecord = await db.aIProvider.findFirst({
    where: { isActive: true },
  });
  if (!providerRecord) return; // No provider — nothing to do

  // Load recent conversation messages for context (last 20)
  const recentMessages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  // Build history
  const history = recentMessages
    .filter((m) => m.senderType !== "BOT" || m.content.trim())
    .map((m) => ({
      role: m.senderType === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

  // Find conversation to get channel + lead info
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    include: { lead: { select: { departmentId: true } } },
  });
  if (!conversation) return;

  const departmentId = conversation.lead?.departmentId ?? null;

  // Build system prompt
  let systemPrompt =
    "You are a helpful travel customer service assistant. Be concise, friendly, and professional.";
  if (departmentId) {
    try {
      systemPrompt = await buildSystemPrompt(db, departmentId, tenantId);
    } catch {
      // Fall back to generic prompt
    }
  }

  // Create provider and generate response
  let aiReplyContent = "";
  let totalTokens = 0;

  try {
    const provider = createProvider(
      providerRecord.provider,
      providerRecord.apiKey,
      providerRecord.modelName
    );

    const response = await provider.chat({
      systemPrompt,
      messages: history,
      temperature: 0.7,
      maxTokens: 500,
    });

    aiReplyContent = response.content ?? "";
    totalTokens = response.usage?.totalTokens ?? 0;
  } catch (err) {
    console.error("[ChatbotService] AI provider error:", err);
    return;
  }

  if (!aiReplyContent.trim()) return;

  // Persist the AI reply
  const botMessage = await db.message.create({
    data: {
      conversationId,
      senderType: "BOT",
      senderId: null,
      content: aiReplyContent,
      messageType: "TEXT",
    },
  });

  // Record AI conversation log
  const aiConv = await db.aIConversation.create({
    data: {
      conversationId,
      providerUsed: providerRecord.provider,
      modelUsed: providerRecord.modelName,
      totalTokens,
      totalCost: 0,
    },
  });

  // Dispatch the bot reply outbound through the message dispatcher
  try {
    const { dispatchMessage } = await import("@/modules/channels/message-dispatcher.service");
    await dispatchMessage(tenantId, conversationId, aiReplyContent, "TEXT");
  } catch (err) {
    console.error("[ChatbotService] dispatch error:", err instanceof Error ? err.message : err);
  }

  void aiConv; // referenced to satisfy linter
  void botMessage;
}
