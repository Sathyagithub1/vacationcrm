// src/modules/intake/spam/index.ts
import type { IntakePayload } from "../types";
import { prisma } from "@/lib/prisma";
import { checkBlacklist } from "./blacklist";
import { checkRateLimit } from "./rate-limit";
import { checkPattern } from "./pattern";
import { checkAi } from "./ai-classifier";

const DEFAULT_AI_THRESHOLD = 0.95;

function senderId(p: IntakePayload): string {
  return p.sender.phone ?? p.sender.email ?? p.sender.channelHandle ?? "unknown";
}

function rawText(p: IntakePayload): string {
  const r = p.rawPayload as Record<string, unknown>;
  return [r.text, r.message, r.body, r.notes]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");
}

/**
 * Spam orchestrator (Phase 6a, Layer 0 of the intake pipeline). Chains the
 * four spam-detection layers in fixed order — blacklist → rate-limit →
 * pattern → AI — short-circuiting on the first match and writing a SpamLog
 * row with action=BLOCKED. When no layer matches, returns the payload with
 * spamCheck.passed=true so the pipeline can proceed to normalize.
 */
export async function checkSpam(payload: IntakePayload): Promise<IntakePayload> {
  const sender = senderId(payload);
  const channel = payload.source;
  const text = rawText(payload);

  const layers: Array<() => Promise<{ blocked: boolean; ruleId?: string }>> = [
    () => checkBlacklist({ tenantId: payload.tenantId, channel, sender }),
    () => checkRateLimit({ tenantId: payload.tenantId, channel, sender }),
    () => checkPattern({ tenantId: payload.tenantId, channel, text }),
    () =>
      checkAi({
        tenantId: payload.tenantId,
        text,
        threshold: DEFAULT_AI_THRESHOLD,
      }),
  ];

  for (const layer of layers) {
    const r = await layer();
    if (r.blocked) {
      await prisma.spamLog.create({
        data: {
          tenantId: payload.tenantId,
          channel,
          senderIdentifier: sender,
          rawPayload: payload.rawPayload as object,
          matchedRuleId: r.ruleId,
          action: "BLOCKED",
        },
      });
      return {
        ...payload,
        spamCheck: { passed: false, matchedRuleId: r.ruleId },
      };
    }
  }

  return { ...payload, spamCheck: { passed: true } };
}
