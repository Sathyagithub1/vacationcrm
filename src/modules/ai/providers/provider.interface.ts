export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatChunk {
  type: "text" | "tool_call" | "done";
  content?: string;
  toolCall?: ToolCall;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatParams {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  knowledgeContext?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SpamClassification {
  isSpam: boolean;
  confidence: number; // [0, 1]
}

export interface AIProvider {
  id: string;
  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
  generateEmbedding(text: string): Promise<number[]>;
  /**
   * Classify whether a piece of customer text is spam.
   * Implementations should call the underlying model with a fixed prompt and
   * parse a JSON `{ isSpam, confidence }` response.
   */
  classify(text: string): Promise<SpamClassification>;
  /**
   * One-shot non-streaming text completion. Returns the raw model output as
   * a plain string. Used by intake utilities that need a short, deterministic
   * answer (e.g. language detection).
   */
  complete(prompt: string): Promise<string>;
  /**
   * One-shot non-streaming completion expected to return valid JSON. Parses
   * the first JSON object found in the response. Throws on invalid JSON —
   * callers decide whether to degrade.
   */
  completeJson(prompt: string): Promise<unknown>;
}
