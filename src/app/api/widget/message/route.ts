import { NextRequest, NextResponse } from "next/server";
import { tenantPrisma } from "@/lib/prisma";
import { extractVisitorToken } from "@/modules/widget/widget-auth.service";
import { incrementVisitorMessages } from "@/modules/widget/visitor.service";
import { shouldRouteToAI, getActiveProvider } from "@/modules/ai/ai-router.service";
import { buildSystemPrompt, buildKnowledgeContext, buildConversationHistory } from "@/modules/ai/context-builder.service";
import { createProvider } from "@/modules/ai/providers";
import { getToolDefinitions, getToolByName } from "@/modules/ai/tools";
import type { ToolContext } from "@/modules/ai/tools";
import type { ChatMessage } from "@/modules/ai/providers/provider.interface";

/**
 * POST /api/widget/message
 *
 * PUBLIC route — authenticated via visitor JWT in Authorization header.
 * Body: { message: string, conversationId: string }
 *
 * Flow:
 *   1. Verify visitor JWT
 *   2. Validate conversation belongs to this tenant
 *   3. Save customer message
 *   4. Route: AI or human-takeover
 *   5. If AI: build context, stream response, collect text + tool calls
 *   6. Execute any tool calls
 *   7. Save bot reply
 *   8. Return { customerMessage, botMessage }
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("Authorization");
    const tokenPayload = extractVisitorToken(authHeader);
    if (!tokenPayload) {
      return NextResponse.json({ error: "Unauthorized — missing or invalid visitor token" }, { status: 401 });
    }

    const { tenantId, visitorId } = tokenPayload;
    const db = tenantPrisma(tenantId);

    // ── Input validation ──────────────────────────────────────────────────────
    const body = await request.json();
    const { message, conversationId } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const trimmedMessage = message.trim();

    // ── Verify conversation exists and belongs to this tenant ─────────────────
    const conversation = await (db.conversation.findFirst as Function)({
      where: { id: conversationId },
      select: { id: true, status: true, customerId: true },
    }) as { id: string; status: string; customerId: string | null } | null;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (conversation.status === "CLOSED") {
      return NextResponse.json({ error: "Conversation is closed" }, { status: 400 });
    }

    // ── Save customer message ─────────────────────────────────────────────────
    const customerMessage = await (db.message.create as Function)({
      data: {
        conversationId,
        senderType: "CUSTOMER",
        senderId: null,
        content: trimmedMessage,
        messageType: "TEXT",
      },
    });

    // Bump visitor message count
    await incrementVisitorMessages(db, visitorId);

    // ── Routing decision ──────────────────────────────────────────────────────
    const routeDecision = shouldRouteToAI(trimmedMessage, conversation.status);

    if (routeDecision.route === "human") {
      // Mark conversation for human takeover if not already
      if (conversation.status !== "HUMAN_TAKEOVER") {
        await (db.conversation.update as Function)({
          where: { id: conversationId },
          data: { status: "HUMAN_TAKEOVER" },
        });
      }

      const handoffMessage = await (db.message.create as Function)({
        data: {
          conversationId,
          senderType: "BOT",
          senderId: null,
          content: "I'm connecting you with a human agent now. Please hold on — someone will be with you shortly.",
          messageType: "TEXT",
        },
      });

      return NextResponse.json({
        customerMessage,
        botMessage: handoffMessage,
        handoff: true,
        handoffReason: routeDecision.reason,
      });
    }

    // ── AI response ───────────────────────────────────────────────────────────
    const aiProvider = await getActiveProvider(db);
    if (!aiProvider) {
      // No AI configured — send a graceful fallback
      const fallbackMessage = await (db.message.create as Function)({
        data: {
          conversationId,
          senderType: "BOT",
          senderId: null,
          content: "Thank you for your message. Our team will get back to you soon.",
          messageType: "TEXT",
        },
      });

      return NextResponse.json({
        customerMessage,
        botMessage: fallbackMessage,
        handoff: false,
      });
    }

    // Resolve department from widget config linked to this conversation's channel
    // We look up any active widget config for this tenant to find the departmentId
    // for context building (knowledge base + system prompt).
    const widgetConfig = await db.widgetConfig.findFirst({
      where: { isActive: true },
      select: { departmentId: true },
      orderBy: { createdAt: "asc" },
    });
    const departmentId = widgetConfig?.departmentId ?? "";

    const [systemPrompt, knowledgeContext, conversationHistory] = await Promise.all([
      buildSystemPrompt(db, departmentId, tenantId),
      buildKnowledgeContext(db, departmentId),
      buildConversationHistory(db, conversationId, 20),
    ]);

    const provider = createProvider(aiProvider.provider, aiProvider.apiKey, aiProvider.modelName);

    const chatMessages: ChatMessage[] = [
      ...conversationHistory,
      { role: "user", content: trimmedMessage },
    ];

    let botTextContent = "";
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    const toolContext: ToolContext = {
      db,
      tenantId,
      departmentId,
      conversationId,
      customerId: conversation.customerId ?? undefined,
    };

    const stream = provider.chat({
      messages: chatMessages,
      systemPrompt,
      knowledgeContext: knowledgeContext || undefined,
      tools: getToolDefinitions(),
      maxTokens: 1024,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      if (chunk.type === "text" && chunk.content) {
        botTextContent += chunk.content;
      } else if (chunk.type === "tool_call" && chunk.toolCall) {
        pendingToolCalls.push(chunk.toolCall);
      }
    }

    // Execute tool calls sequentially and collect results for context
    for (const toolCall of pendingToolCalls) {
      const tool = getToolByName(toolCall.name);
      if (!tool) continue;

      try {
        const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        const result = await tool.execute(args, toolContext);

        // Append tool result summary to bot text if no text was generated
        if (!botTextContent && result.message) {
          botTextContent = result.message;
        }
      } catch (toolErr) {
        console.error(`[Widget] Tool "${toolCall.name}" failed:`, toolErr);
      }
    }

    // Ensure we always have something to return
    if (!botTextContent.trim()) {
      botTextContent = "I understand. Is there anything else I can help you with?";
    }

    // Save bot message
    const botMessage = await (db.message.create as Function)({
      data: {
        conversationId,
        senderType: "BOT",
        senderId: null,
        content: botTextContent,
        messageType: "TEXT",
      },
    });

    return NextResponse.json({
      customerMessage,
      botMessage,
      handoff: false,
    });
  } catch (error) {
    console.error("POST /api/widget/message error:", error);
    return NextResponse.json({ error: "Failed to process message" }, { status: 500 });
  }
}
