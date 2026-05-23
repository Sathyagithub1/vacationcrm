import type { AIProvider } from "./provider.interface";
import { ClaudeAdapter } from "./claude.adapter";
import { OpenAIAdapter } from "./openai.adapter";
import { GeminiAdapter } from "./gemini.adapter";
import { decrypt } from "@/lib/encryption";

export type {
  AIProvider,
  ChatParams,
  ChatChunk,
  ChatMessage,
  ToolDefinition,
  ToolCall,
} from "./provider.interface";

export function createProvider(
  provider: string,
  encryptedApiKey: string,
  modelName: string
): AIProvider {
  const apiKey = decrypt(encryptedApiKey);
  switch (provider) {
    case "CLAUDE":
      return new ClaudeAdapter(apiKey, modelName);
    case "OPENAI":
      return new OpenAIAdapter(apiKey, modelName);
    case "GEMINI":
      return new GeminiAdapter(apiKey, modelName);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}
