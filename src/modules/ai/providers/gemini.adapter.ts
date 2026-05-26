import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Tool,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";
import type {
  AIProvider,
  ChatChunk,
  ChatMessage,
  ChatParams,
  SpamClassification,
  ToolDefinition,
} from "./provider.interface";
import {
  parseFirstJsonObject,
  parseSpamClassification,
  SPAM_CLASSIFY_PROMPT,
} from "./classify-prompt";

export class GeminiAdapter implements AIProvider {
  readonly id = "GEMINI";
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatChunk> {
    const { messages, systemPrompt, tools, knowledgeContext, maxTokens, temperature } = params;

    // Build system instruction, appending knowledge context if provided
    const systemInstruction = knowledgeContext
      ? `${systemPrompt}\n\n<knowledge_context>\n${knowledgeContext}\n</knowledge_context>`
      : systemPrompt;

    // Map our ToolDefinition format to Gemini's FunctionDeclaration format
    const geminiTools: Tool[] | undefined =
      tools && tools.length > 0
        ? [
            {
              functionDeclarations: tools.map(
                (t: ToolDefinition): FunctionDeclaration => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters as unknown as FunctionDeclarationSchema,
                })
              ),
            },
          ]
        : undefined;

    const generativeModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction,
      generationConfig: {
        maxOutputTokens: maxTokens ?? 4096,
        temperature: temperature ?? 0.7,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
      ...(geminiTools ? { tools: geminiTools } : {}),
    });

    // Split history (all but last user message) from the current user turn
    const allNonSystem = messages.filter((m) => m.role !== "system");
    const historyMessages = allNonSystem.slice(0, -1);
    const lastMessage = allNonSystem[allNonSystem.length - 1];

    // Map our ChatMessage format to Gemini's Content format for history
    const history: Content[] = historyMessages.map((m: ChatMessage): Content => {
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.toolCallId ?? "unknown_tool",
                response: { result: m.content },
              },
            },
          ],
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const parts: Part[] = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: JSON.parse(tc.arguments) as Record<string, unknown>,
            },
          });
        }
        return { role: "model", parts };
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      };
    });

    // Build the current turn parts
    const currentParts: Part[] =
      lastMessage
        ? lastMessage.role === "tool"
          ? [
              {
                functionResponse: {
                  name: lastMessage.toolCallId ?? "unknown_tool",
                  response: { result: lastMessage.content },
                },
              },
            ]
          : [{ text: lastMessage.content }]
        : [{ text: "" }];

    const chat = generativeModel.startChat({ history });
    const streamResult = await chat.sendMessageStream(currentParts);

    for await (const chunk of streamResult.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;

      for (const part of candidate.content.parts) {
        if (part.text) {
          yield { type: "text", content: part.text };
        }
        if (part.functionCall) {
          yield {
            type: "tool_call",
            toolCall: {
              id: `${part.functionCall.name}_${Date.now()}`,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          };
        }
      }
    }

    // Emit done with usage from the aggregated response
    const aggregated = await streamResult.response;
    const usageMeta = aggregated.usageMetadata;
    yield {
      type: "done",
      usage: {
        inputTokens: usageMeta?.promptTokenCount ?? 0,
        outputTokens: usageMeta?.candidatesTokenCount ?? 0,
      },
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.client.getGenerativeModel({
      model: "text-embedding-004",
    });
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  }

  async classify(text: string): Promise<SpamClassification> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: SPAM_CLASSIFY_PROMPT,
      generationConfig: { maxOutputTokens: 100, temperature: 0 },
    });
    const result = await model.generateContent(text);
    const raw = result.response.text();
    return parseSpamClassification(raw);
  }

  async complete(prompt: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: { maxOutputTokens: 1024, temperature: 0 },
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async completeJson(prompt: string): Promise<unknown> {
    const raw = await this.complete(prompt);
    return parseFirstJsonObject(raw);
  }
}
