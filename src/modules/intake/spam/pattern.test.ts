// src/modules/intake/spam/pattern.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { checkPattern } from "./pattern";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

const TENANTS = ["tenant-pattern-1", "tenant-pattern-2", "tenant-pattern-3"];

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

describe("checkPattern", () => {
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

  it("matches regex pattern in text", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-pattern-1",
        type: "PATTERN",
        identifier: "\\b(crypto|nft|airdrop)\\b",
        channels: [],
        departmentIds: [],
      },
    });
    const r = await checkPattern({
      tenantId: "tenant-pattern-1",
      channel: "WHATSAPP",
      text: "free crypto airdrop",
    });
    expect(r.blocked).toBe(true);
  });

  it("does not match when text safe", async () => {
    // tenant-pattern-3 has no rules — must return blocked=false
    const r = await checkPattern({
      tenantId: "tenant-pattern-3",
      channel: "WHATSAPP",
      text: "hello sir",
    });
    expect(r.blocked).toBe(false);
  });

  it("ignores invalid regex (logs warn)", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-pattern-2",
        type: "PATTERN",
        identifier: "[invalid(",
        channels: [],
        departmentIds: [],
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await checkPattern({
      tenantId: "tenant-pattern-2",
      channel: "WHATSAPP",
      text: "anything",
    });
    expect(r.blocked).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
