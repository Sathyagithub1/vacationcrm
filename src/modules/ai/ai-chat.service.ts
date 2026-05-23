import { publishEvent } from "@/lib/redis";
import { createProvider } from "./providers";
import {
  buildSystemPrompt,
  buildKnowledgeContext,
  buildConversationHistory,
} from "./context-builder.service";
import { getActiveProvider, shouldRouteToAI } from "./ai-router.service";
import { getToolByName, getToolDefinitions } from "./tools";
import type { ToolCall, ChatMessage } from "./providers/provider.interface";
import type { ToolResult } from "./tools/tool.interface";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export interface ProcessAIMessageParams {
  db: TenantDb;
  tenantId: string;
  conversationId: string;
  departmentId: string;
  customerMessage: string;
  customerId?: string;
}

export interface ProcessAIMessageResult {
  response: string;
  handoff: boolean;
  toolResults: Array<{ toolName: string; result: ToolResult }>;
}

/**
 * Main AI orchestration function. Given a customer message it:
 *  1. Checks routing rules (human takeover, escalation keywords).
 *  2. Fetches the active AI provider for this tenant.
 *  3. Builds system prompt, knowledge context, and conversation history.
 *  4. Runs the AI chat loop, handling tool calls when they arise.
 *  5. Persists the bot reply as a Message record.
 *  6. Publishes a ws:message:new event via Redis for WebSocket delivery.
 *  7. Updates token/cost counters on the AIConversation record.
 *  8. Returns the final text response, handoff flag, and tool results.
 */
export async function processAIMessage({
  db,
  tenantId,
  conversationId,
  departmentId,
  customerMessage,
  customerId,
}: ProcessAIMessageParams): Promise<ProcessAIMessageResult> {
  // ── 1. Fetch conversation to check its current status ──────────────────────
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { id: true, status: true },
  });

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  // ── 2. Routing decision ────────────────────────────────────────────────────
  const routeDecision = shouldRouteToAI(customerMessage, conversation.status);
  if (routeDecision.route === "human") {
    // Ensure the conversation is in HUMAN_TAKEOVER state
    if (conversation.status !== "HUMAN_TAKEOVER") {
      await db.conversation.update({
        where: { id: conversationId },
        data: { status: "HUMAN_TAKEOVER" },
      });
    }
    const handoffMessage =
      "I'm connecting you with a human agent right away. Please hold on for a moment.";

    const savedMessage = await db.message.create({
      data: {
        tenantId,
        conversationId,
        senderType: "BOT",
        content: handoffMessage,
      },
    });

    publishEvent(`ws:message:new`, {
      tenantId,
      conversationId,
      message: {
        id: savedMessage.id,
        content: handoffMessage,
        senderType: "BOT",
        createdAt: savedMessage.createdAt,
      },
    });

    return {
      response: handoffMessage,
      handoff: true,
      toolResults: [],
    };
  }

  // ── 3. Get active AI provider ──────────────────────────────────────────────
  const providerRecord = await getActiveProvider(db);
  if (!providerRecord) {
    throw new Error("No active AI provider configured for this tenant");
  }

  const provider = createProvider(
    providerRecord.provider,
    providerRecord.apiKey,
    providerRecord.modelName
  );

  // ── 4. Build context ───────────────────────────────────────────────────────
  const [systemPrompt, knowledgeContext, history] = await Promise.all([
    buildSystemPrompt(db, departmentId, tenantId),
    buildKnowledgeContext(db, departmentId),
    buildConversationHistory(db, conversationId, 20),
  ]);

  // ── 5. AI chat loop with tool execution ───────────────────────────────────
  // We append the current customer message to the history so the provider
  // sees the complete conversation up to this moment.
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: customerMessage },
  ];

  const toolContext = {
    db,
    tenantId,
    departmentId,
    conversationId,
    customerId,
  };

  const collectedToolResults: Array<{ toolName: string; result: ToolResult }> =
    [];
  let handoff = false;
  let handoffReason: string | null = null;
  let responseText = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Agentic loop: keep executing tool calls until the model returns a final
  // text response with no pending tool calls.
  const MAX_TOOL_ROUNDS = 5;
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round += 1;

    const pendingToolCalls: ToolCall[] = [];
    let roundText = "";

    const stream = provider.chat({
      messages,
      systemPrompt,
      tools: getToolDefinitions(),
      knowledgeContext: knowledgeContext || undefined,
    });

    for await (const chunk of stream) {
      if (chunk.type === "text" && chunk.content) {
        roundText += chunk.content;
      } else if (chunk.type === "tool_call" && chunk.toolCall) {
        pendingToolCalls.push(chunk.toolCall);
      } else if (chunk.type === "done" && chunk.usage) {
        totalInputTokens += chunk.usage.inputTokens;
        totalOutputTokens += chunk.usage.outputTokens;
      }
    }

    // No tool calls — this is the final answer
    if (pendingToolCalls.length === 0) {
      responseText = roundText;
      break;
    }

    // Append the assistant's turn (which includes tool call requests) to the
    // running message list so the next round has full context.
    messages.push({
      role: "assistant",
      content: roundText,
      toolCalls: pendingToolCalls,
    });

    // Execute each tool and append the results as tool messages
    for (const toolCall of pendingToolCalls) {
      const tool = getToolByName(toolCall.name);

      if (!tool) {
        const errorResult: ToolResult = {
          success: false,
          message: `Unknown tool: ${toolCall.name}`,
        };
        messages.push({
          role: "tool",
          content: JSON.stringify(errorResult),
          toolCallId: toolCall.id,
        });
        collectedToolResults.push({
          toolName: toolCall.name,
          result: errorResult,
        });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
      } catch {
        // Leave args as empty object; the tool will handle missing fields
      }

      const result = await tool.execute(args, toolContext);
      collectedToolResults.push({ toolName: toolCall.name, result });

      // Detect handoff via the handoff tool's result payload
      if (
        toolCall.name === "handoff_to_agent" &&
        result.success &&
        result.data?.status === "HUMAN_TAKEOVER"
      ) {
        handoff = true;
        handoffReason =
          typeof result.data.reason === "string"
            ? result.data.reason
            : "Customer requested handoff";
      }

      messages.push({
        role: "tool",
        content: JSON.stringify(result),
        toolCallId: toolCall.id,
      });
    }

    // If handoff was triggered, run one final non-tool pass to get the
    // farewell message, then exit the loop.
    if (handoff) {
      const finalStream = provider.chat({
        messages,
        systemPrompt,
        knowledgeContext: knowledgeContext || undefined,
        // No tools on the final pass — force a plain text response
      });
      let finalText = "";
      for await (const chunk of finalStream) {
        if (chunk.type === "text" && chunk.content) {
          finalText += chunk.content;
        } else if (chunk.type === "done" && chunk.usage) {
          totalInputTokens += chunk.usage.inputTokens;
          totalOutputTokens += chunk.usage.outputTokens;
        }
      }
      responseText =
        finalText ||
        "I'm connecting you with a human agent now. They will be with you shortly.";
      break;
    }
  }

  // Fallback: loop exhausted with no response — escalate gracefully
  if (!responseText) {
    responseText =
      "I apologise for the delay. Let me connect you with a human agent who can assist you better.";
    handoff = true;
    handoffReason = "Bot loop exhausted without producing a response";

    // Update conversation status since handoff tool was never called
    await db.conversation.update({
      where: { id: conversationId },
      data: { status: "HUMAN_TAKEOVER" },
    });
  }

  // ── 6. Persist bot reply ───────────────────────────────────────────────────
  const savedBotMessage = await db.message.create({
    data: {
      tenantId,
      conversationId,
      senderType: "BOT",
      content: responseText,
    },
  });

  // ── 7. Publish WebSocket event ─────────────────────────────────────────────
  publishEvent(`ws:message:new`, {
    tenantId,
    conversationId,
    message: {
      id: savedBotMessage.id,
      content: responseText,
      senderType: "BOT",
      createdAt: savedBotMessage.createdAt,
    },
  });

  // ── 8. Update AIConversation token/cost counters ───────────────────────────
  // Find the latest AIConversation linked to this conversation (there may be
  // more than one across sessions; we update the most recent).
  const aiConversation = await db.aIConversation.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (aiConversation) {
    // Approximate per-token costs for informational/billing tracking.
    // Rates are per 1 000 tokens; adjust if provider pricing changes.
    const inputCostPer1k =
      providerRecord.provider === "CLAUDE"
        ? 0.003
        : providerRecord.provider === "OPENAI"
          ? 0.002
          : 0.0005; // GEMINI / CUSTOM

    const outputCostPer1k =
      providerRecord.provider === "CLAUDE"
        ? 0.015
        : providerRecord.provider === "OPENAI"
          ? 0.008
          : 0.0015; // GEMINI / CUSTOM

    const costUsd =
      (totalInputTokens / 1000) * inputCostPer1k +
      (totalOutputTokens / 1000) * outputCostPer1k;

    await db.aIConversation.update({
      where: { id: aiConversation.id },
      data: {
        totalTokens: { increment: totalInputTokens + totalOutputTokens },
        totalCost: { increment: costUsd },
        ...(handoff && handoffReason ? { handoffReason } : {}),
      },
    });
  }

  return {
    response: responseText,
    handoff,
    toolResults: collectedToolResults,
  };
}
