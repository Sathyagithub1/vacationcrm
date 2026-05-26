import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ChatChunk,
  ChatMessage,
  ChatParams,
  SpamClassification,
  ToolDefinition,
} from "./provider.interface";
import { parseSpamClassification, SPAM_CLASSIFY_PROMPT } from "./classify-prompt";

export class ClaudeAdapter implements AIProvider {
  readonly id = "CLAUDE";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { messages, systemPrompt, tools, knowledgeContext, maxTokens, temperature } = params;

    // Build system prompt, appending knowledge context if provided
    const fullSystemPrompt = knowledgeContext
      ? `${systemPrompt}\n\n<knowledge_context>\n${knowledgeContext}\n</knowledge_context>`
      : systemPrompt;

    // Map our ChatMessage format to Anthropic's MessageParam format
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m): Anthropic.MessageParam => {
        if (m.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.toolCallId ?? "",
                content: m.content,
              },
            ],
          };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: [
              ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
              ...m.toolCalls.map((tc) => ({
                type: "tool_use" as const,
                id: tc.id,
                name: tc.name,
                input: JSON.parse(tc.arguments) as Record<string, unknown>,
              })),
            ],
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      });

    // Map our ToolDefinition format to Anthropic's ToolParam format
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        ...(t.parameters as Record<string, unknown>),
      },
    }));

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0.7,
      system: fullSystemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    let currentToolCallId: string | null = null;
    let currentToolName: string | null = null;
    let currentToolArgs = "";

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolCallId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolArgs = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text", content: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          currentToolArgs += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCallId && currentToolName) {
          yield {
            type: "tool_call",
            toolCall: {
              id: currentToolCallId,
              name: currentToolName,
              arguments: currentToolArgs,
            },
          };
          currentToolCallId = null;
          currentToolName = null;
          currentToolArgs = "";
        }
      } else if (event.type === "message_delta" && event.usage) {
        yield {
          type: "done",
          usage: {
            inputTokens: 0, // input tokens come from message_start
            outputTokens: event.usage.output_tokens,
          },
        };
      }
    }

    // Emit final done with full usage from the final message
    const finalMessage = await stream.finalMessage();
    yield {
      type: "done",
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    };
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    throw new Error(
      "Claude does not support embeddings directly. Use OpenAI (text-embedding-3-small) or Gemini (text-embedding-004) for embedding generation."
    );
  }

  async classify(text: string): Promise<SpamClassification> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 100,
      temperature: 0,
      system: SPAM_CLASSIFY_PROMPT,
      messages: [{ role: "user", content: text }],
    });
    const block = response.content.find((c) => c.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    return parseSpamClassification(raw);
  }
}
