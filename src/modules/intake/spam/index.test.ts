// src/modules/intake/spam/index.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

// Mock all four layer modules so this test exercises orchestration only,
// not the underlying layer implementations (those have their own tests).
vi.mock("./blacklist", () => ({ checkBlacklist: vi.fn() }));
vi.mock("./rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("./pattern", () => ({ checkPattern: vi.fn() }));
vi.mock("./ai-classifier", () => ({ checkAi: vi.fn() }));

import { checkSpam } from "./index";
import { checkBlacklist } from "./blacklist";
import { checkRateLimit } from "./rate-limit";
import { checkPattern } from "./pattern";
import { checkAi } from "./ai-classifier";

const TENANT_ID = "tenant-orchestrator-1";

async function ensureTenant() {
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: TENANT_ID, slug: TENANT_ID },
  });
}

async function clearSpam() {
  await prisma.spamLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.spamRule.deleteMany({ where: { tenantId: TENANT_ID } });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    source: "WHATSAPP",
    sender: { phone: "+91999" },
    rawPayload: { text: "hi" },
    webhookLogId: "wh-1",
    ...overrides,
  } as Parameters<typeof checkSpam>[0];
}

const NOT_BLOCKED = { blocked: false } as const;

describe("checkSpam orchestrator", () => {
  beforeEach(async () => {
    vi.mocked(checkBlacklist).mockReset();
    vi.mocked(checkRateLimit).mockReset();
    vi.mocked(checkPattern).mockReset();
    vi.mocked(checkAi).mockReset();
    await ensureTenant();
    await clearSpam();
    await redis.flushdb();
  });

  afterAll(async () => {
    await clearSpam();
    await redis.flushdb();
    await prisma.$disconnect();
  });

  it("passes when no layer matches", async () => {
    vi.mocked(checkBlacklist).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkRateLimit).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkPattern).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkAi).mockResolvedValue(NOT_BLOCKED);

    const r = await checkSpam(basePayload());

    expect(r.spamCheck?.passed).toBe(true);
    expect(r.spamCheck?.matchedRuleId).toBeUndefined();
    expect(checkBlacklist).toHaveBeenCalledOnce();
    expect(checkRateLimit).toHaveBeenCalledOnce();
    expect(checkPattern).toHaveBeenCalledOnce();
    expect(checkAi).toHaveBeenCalledOnce();
  });

  it("short-circuits on first (blacklist) layer match", async () => {
    vi.mocked(checkBlacklist).mockResolvedValue({
      blocked: true,
      ruleId: "rule-bl-1",
    });

    const r = await checkSpam(basePayload());

    expect(r.spamCheck?.passed).toBe(false);
    expect(r.spamCheck?.matchedRuleId).toBe("rule-bl-1");
    expect(checkBlacklist).toHaveBeenCalledOnce();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(checkPattern).not.toHaveBeenCalled();
    expect(checkAi).not.toHaveBeenCalled();
  });

  it("falls through to later layers and short-circuits on pattern match", async () => {
    vi.mocked(checkBlacklist).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkRateLimit).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkPattern).mockResolvedValue({
      blocked: true,
      ruleId: "rule-pat-1",
    });

    const r = await checkSpam(basePayload());

    expect(r.spamCheck?.passed).toBe(false);
    expect(r.spamCheck?.matchedRuleId).toBe("rule-pat-1");
    expect(checkAi).not.toHaveBeenCalled();
  });

  it("writes a SpamLog row with action=BLOCKED on block", async () => {
    vi.mocked(checkBlacklist).mockResolvedValue({
      blocked: true,
      ruleId: "rule-bl-1",
    });

    await checkSpam(
      basePayload({
        sender: { phone: "+91-blocked-sender" },
        rawPayload: { text: "evil payload" },
      })
    );

    const logs = await prisma.spamLog.findMany({
      where: { tenantId: TENANT_ID },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("BLOCKED");
    expect(logs[0].channel).toBe("WHATSAPP");
    expect(logs[0].senderIdentifier).toBe("+91-blocked-sender");
    expect(logs[0].matchedRuleId).toBe("rule-bl-1");
  });

  it("does NOT write a SpamLog when passing", async () => {
    vi.mocked(checkBlacklist).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkRateLimit).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkPattern).mockResolvedValue(NOT_BLOCKED);
    vi.mocked(checkAi).mockResolvedValue(NOT_BLOCKED);

    await checkSpam(basePayload());

    const logs = await prisma.spamLog.findMany({
      where: { tenantId: TENANT_ID },
    });
    expect(logs).toHaveLength(0);
  });
});
