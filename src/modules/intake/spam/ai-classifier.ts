// src/modules/intake/spam/ai-classifier.ts
import crypto from "node:crypto";
import { redis } from "@/lib/redis";
import { getAIProvider } from "@/modules/ai/provider";

const CACHE_TTL = 3600; // 1 hour

export interface AiInput {
  tenantId: string;
  text: string;
  threshold: number;
  /** Test-only hook: when true, simulates an upstream failure. */
  _forceFail?: boolean;
}

export interface AiResult {
  blocked: boolean;
  /** Set when the upstream classifier failed and we returned a safe default. */
  degraded?: boolean;
  ruleId?: string;
}

/**
 * Layer 4 of the spam pipeline: calls the tenant's configured AI provider to
 * classify the message text as spam vs. not-spam. Results are cached in
 * Redis under spam:ai:<sha256(text)> for 1 hour to keep cost down on
 * repeated payloads. On any upstream failure (network, parse, missing
 * provider) the request is allowed through with `degraded: true` so the
 * pipeline fails open instead of fails closed.
 */
export async function checkAi(input: AiInput): Promise<AiResult> {
  if (!input.text?.trim()) return { blocked: false };

  const key = `spam:ai:${crypto
    .createHash("sha256")
    .update(input.text)
    .digest("hex")}`;

  const cached = await redis.get(key);
  if (cached) {
    const { isSpam, confidence } = JSON.parse(cached) as {
      isSpam: boolean;
      confidence: number;
    };
    return { blocked: isSpam && confidence >= input.threshold };
  }

  try {
    if (input._forceFail) throw new Error("forced");
    const provider = await getAIProvider(input.tenantId);
    const res = await provider.classify(input.text);
    await redis.set(key, JSON.stringify(res), "EX", CACHE_TTL);
    return { blocked: res.isSpam && res.confidence >= input.threshold };
  } catch (e) {
    console.warn(
      `[spam/ai] classifier failure, degraded mode: ${(e as Error).message}`
    );
    return { blocked: false, degraded: true };
  }
}
