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

export interface AIProvider {
  id: string;
  chat(params: ChatParams): AsyncGenerator<ChatChunk>;
  generateEmbedding(text: string): Promise<number[]>;
}
