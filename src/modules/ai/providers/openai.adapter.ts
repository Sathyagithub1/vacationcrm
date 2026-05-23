import OpenAI from "openai";
import type {
  AIProvider,
  ChatChunk,
  ChatMessage,
  ChatParams,
  ToolDefinition,
} from "./provider.interface";

export class OpenAIAdapter implements AIProvider {
  readonly id = "OPENAI";
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { messages, systemPrompt, tools, knowledgeContext, maxTokens, temperature } = params;

    // Build system prompt, appending knowledge context if provided
    const fullSystemContent = knowledgeContext
      ? `${systemPrompt}\n\n<knowledge_context>\n${knowledgeContext}\n</knowledge_context>`
      : systemPrompt;

    // Map our ChatMessage format to OpenAI's ChatCompletionMessageParam format
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: fullSystemContent },
      ...messages
        .filter((m) => m.role !== "system")
        .map((m): OpenAI.Chat.ChatCompletionMessageParam => {
          if (m.role === "tool") {
            return {
              role: "tool",
              tool_call_id: m.toolCallId ?? "",
              content: m.content,
            };
          }
          if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: "assistant",
              content: m.content || null,
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              })),
            };
          }
          return {
            role: m.role as "user" | "assistant",
            content: m.content,
          };
        }),
    ];

    // Map our ToolDefinition format to OpenAI's ChatCompletionTool format
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools?.map(
      (t: ToolDefinition) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })
    );

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0.7,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
    });

    // Accumulate tool call deltas keyed by index
    const toolCallAccumulator: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (!choice) {
        // This chunk carries only usage info
        if (chunk.usage) {
          yield {
            type: "done",
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            },
          };
        }
        continue;
      }

      const delta = choice.delta;

      // Handle text content
      if (delta.content) {
        yield { type: "text", content: delta.content };
      }

      // Accumulate tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAccumulator[idx]) {
            toolCallAccumulator[idx] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          if (tc.function?.name) {
            toolCallAccumulator[idx].name += tc.function.name;
          }
          if (tc.function?.arguments) {
            toolCallAccumulator[idx].arguments += tc.function.arguments;
          }
          if (tc.id) {
            toolCallAccumulator[idx].id = tc.id;
          }
        }
      }

      // When this choice is done, emit any completed tool calls
      if (choice.finish_reason === "tool_calls") {
        for (const accumulated of Object.values(toolCallAccumulator)) {
          yield {
            type: "tool_call",
            toolCall: {
              id: accumulated.id,
              name: accumulated.name,
              arguments: accumulated.arguments,
            },
          };
        }
      }
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  }
}
