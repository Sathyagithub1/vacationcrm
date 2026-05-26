// src/modules/intake/spam/pattern.ts
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

const CACHE_TTL = 300; // 5 minutes

export interface PatternInput {
  tenantId: string;
  channel: string;
  text: string;
}

export interface PatternResult {
  blocked: boolean;
  ruleId?: string;
}

interface CachedRule {
  id: string;
  identifier: string;
  channels: string[];
  departmentIds: string[];
}

async function getRules(tenantId: string): Promise<CachedRule[]> {
  const cacheKey = `spam:patterns:${tenantId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as CachedRule[];

  const rules = await prisma.spamRule.findMany({
    where: {
      tenantId,
      type: "PATTERN",
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      identifier: true,
      channels: true,
      departmentIds: true,
    },
  });
  await redis.set(cacheKey, JSON.stringify(rules), "EX", CACHE_TTL);
  return rules;
}

/**
 * Layer 3 of the spam pipeline: applies any active PATTERN SpamRule regexes
 * to the incoming message text. Rules are cached in Redis per tenant for 5
 * minutes to keep this hot path off Postgres on every request. Invalid
 * regex patterns are skipped (with a console.warn) rather than crashing the
 * pipeline.
 */
export async function checkPattern(
  input: PatternInput
): Promise<PatternResult> {
  const rules = await getRules(input.tenantId);
  for (const r of rules) {
    if (r.channels.length > 0 && !r.channels.includes(input.channel)) continue;
    try {
      const re = new RegExp(r.identifier, "i");
      if (re.test(input.text)) return { blocked: true, ruleId: r.id };
    } catch {
      console.warn(
        `[spam/pattern] invalid regex on rule ${r.id}: ${r.identifier}`
      );
    }
  }
  return { blocked: false };
}
