/**
 * Public entry-point for the AI provider abstraction used by intake modules.
 *
 * Wraps `createProvider` from ./providers/index.ts and resolves the active
 * AIProvider row for a given tenant. Extends the underlying AIProvider
 * interface with a `classify(text)` method used by the spam AI classifier
 * layer.
 */
import { prisma } from "@/lib/prisma";
import { createProvider } from "./providers";
import type { AIProvider } from "./providers/provider.interface";

export type SpamClassification = { isSpam: boolean; confidence: number };

export interface AIProviderWithClassify extends AIProvider {
  /**
   * Classify whether a piece of customer text is spam.
   * Implementations should return `{ isSpam, confidence }` where `confidence`
   * is in the range [0, 1]. On parsing or upstream failure, throw — callers
   * (e.g. the spam AI classifier layer) decide whether to degrade.
   */
  classify(text: string): Promise<SpamClassification>;
}

/**
 * Resolve the active AI provider for a tenant. Returns a provider with the
 * `classify()` method available. Throws if no active provider is configured
 * for the tenant.
 */
export async function getAIProvider(
  tenantId: string
): Promise<AIProviderWithClassify> {
  const row = await prisma.aIProvider.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!row) {
    throw new Error(`No active AI provider configured for tenant ${tenantId}`);
  }
  // All adapters implement classify() — see Claude/OpenAI/Gemini adapter files.
  return createProvider(row.provider, row.apiKey, row.modelName) as AIProviderWithClassify;
}
