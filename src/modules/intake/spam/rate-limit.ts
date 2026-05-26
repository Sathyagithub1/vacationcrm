// src/modules/intake/spam/rate-limit.ts
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export interface RateLimitInput {
  tenantId: string;
  channel: string;
  sender: string;
}

export interface RateLimitResult {
  blocked: boolean;
  ruleId?: string;
}

/**
 * Layer 2 of the spam pipeline: fixed-window rate limiting backed by
 * Redis INCR + EXPIRE. When a sender crosses any matching RATE_LIMIT rule's
 * threshold within the configured window, a temporary BLACKLIST SpamRule is
 * auto-created with expiresAt = now + blockSeconds so subsequent traffic is
 * blocked by Layer 1 without re-hitting Redis.
 */
export async function checkRateLimit(
  input: RateLimitInput
): Promise<RateLimitResult> {
  const rules = await prisma.spamRule.findMany({
    where: {
      tenantId: input.tenantId,
      type: "RATE_LIMIT",
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const matching = rules.filter(
    (r) => r.channels.length === 0 || r.channels.includes(input.channel)
  );

  for (const rule of matching) {
    const key = `rl:${input.tenantId}:${rule.id}:${input.sender}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rule.windowSeconds ?? 60);
    if (count >= (rule.threshold ?? 10)) {
      const expiresAt = new Date(
        Date.now() + (rule.blockSeconds ?? 604800) * 1000
      );
      const autoRule = await prisma.spamRule.create({
        data: {
          tenantId: input.tenantId,
          type: "BLACKLIST",
          identifier: input.sender,
          channels: rule.channels,
          departmentIds: rule.departmentIds,
          reason: `Auto-block: ${rule.threshold} msgs in ${rule.windowSeconds}s`,
          expiresAt,
          isActive: true,
        },
      });
      return { blocked: true, ruleId: autoRule.id };
    }
  }

  return { blocked: false };
}
