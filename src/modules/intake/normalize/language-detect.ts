// src/modules/intake/normalize/language-detect.ts
import { getAIProvider } from "@/modules/ai/provider";

/**
 * Detect the primary language of a piece of text via the tenant's configured
 * AI provider. Returns the ISO 639-1 code (2-letter lowercase) or `undefined`
 * when:
 *   - the input is empty/whitespace
 *   - the provider call fails
 *   - the response is not a valid 2-letter code
 *
 * Failing soft keeps the intake pipeline from breaking when the LLM is
 * temporarily unavailable — language is best-effort metadata, not a gate.
 */
export async function detectLanguage(
  tenantId: string,
  text: string
): Promise<string | undefined> {
  if (!text?.trim()) return undefined;
  try {
    const provider = await getAIProvider(tenantId);
    const prompt =
      "Identify the primary language of this text and respond with the ISO " +
      "639-1 code only (2 letters lowercase). Text: \"\"\"" +
      text.slice(0, 500) +
      '"""';
    const r = (await provider.complete(prompt)).trim().toLowerCase();
    return /^[a-z]{2}$/.test(r) ? r : undefined;
  } catch {
    return undefined;
  }
}
