// src/modules/intake/spam/rate-limit.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { checkRateLimit } from "./rate-limit";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

const TENANTS = ["tenant-ratelimit-1", "tenant-ratelimit-2"];

async function ensureTenants() {
  for (const id of TENANTS) {
    await prisma.tenant.upsert({
      where: { id },
      update: {},
      create: { id, name: id, slug: id },
    });
  }
}

async function clearSpamRows() {
  await prisma.spamLog.deleteMany({ where: { tenantId: { in: TENANTS } } });
  await prisma.spamRule.deleteMany({ where: { tenantId: { in: TENANTS } } });
}

describe("checkRateLimit", () => {
  beforeEach(async () => {
    await redis.flushdb();
    await ensureTenants();
    await clearSpamRows();
  });

  afterAll(async () => {
    await clearSpamRows();
    await redis.flushdb();
    await prisma.$disconnect();
  });

  it("does not block under threshold", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-ratelimit-1",
        type: "RATE_LIMIT",
        identifier: "ALL",
        channels: ["WHATSAPP"],
        threshold: 10,
        windowSeconds: 60,
        blockSeconds: 604800,
      },
    });
    for (let i = 0; i < 9; i++) {
      const r = await checkRateLimit({
        tenantId: "tenant-ratelimit-1",
        channel: "WHATSAPP",
        sender: "+91123",
      });
      expect(r.blocked).toBe(false);
    }
  });

  it("blocks on Nth message and creates auto-blacklist rule", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-ratelimit-2",
        type: "RATE_LIMIT",
        identifier: "ALL",
        channels: ["WHATSAPP"],
        threshold: 3,
        windowSeconds: 60,
        blockSeconds: 60,
      },
    });
    let last:
      | Awaited<ReturnType<typeof checkRateLimit>>
      | undefined;
    for (let i = 0; i < 3; i++) {
      last = await checkRateLimit({
        tenantId: "tenant-ratelimit-2",
        channel: "WHATSAPP",
        sender: "+91123",
      });
    }
    expect(last!.blocked).toBe(true);
    const autoRule = await prisma.spamRule.findFirst({
      where: {
        tenantId: "tenant-ratelimit-2",
        type: "BLACKLIST",
        identifier: "+91123",
      },
    });
    expect(autoRule).not.toBeNull();
    expect(autoRule!.expiresAt).not.toBeNull();
  });
});
