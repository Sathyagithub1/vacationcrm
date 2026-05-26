import type { SpamClassification } from "./provider.interface";

export const SPAM_CLASSIFY_PROMPT =
  "Classify whether the following customer message is spam. " +
  "Reply with ONLY a single JSON object on one line in the exact shape " +
  '{"isSpam": boolean, "confidence": number} where confidence is a value ' +
  "between 0 and 1. Do not include any other text, code fences, or explanation.";

/**
 * Extract a `{ isSpam, confidence }` JSON object from a model response. Tolerates
 * surrounding prose and code fences. Throws if no valid JSON object is found
 * or the fields are missing/invalid — callers (e.g. AI classifier spam layer)
 * should catch and degrade.
 */
export function parseSpamClassification(raw: string): SpamClassification {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`No JSON object in classifier response: ${raw}`);
  const parsed = JSON.parse(match[0]) as { isSpam?: unknown; confidence?: unknown };
  const isSpam = parsed.isSpam;
  const confidence = parsed.confidence;
  if (typeof isSpam !== "boolean" || typeof confidence !== "number") {
    throw new Error(`Invalid classifier shape: ${raw}`);
  }
  return {
    isSpam,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}
