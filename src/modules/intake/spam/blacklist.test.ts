// src/modules/intake/spam/blacklist.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { checkBlacklist } from "./blacklist";
import { prisma } from "@/lib/prisma";

const TENANTS = [
  "tenant-blacklist-1",
  "tenant-blacklist-2",
  "tenant-blacklist-3",
];

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

describe("checkBlacklist", () => {
  beforeEach(async () => {
    await ensureTenants();
    await clearSpamRows();
  });

  afterAll(async () => {
    await clearSpamRows();
    await prisma.$disconnect();
  });

  it("matches on exact identifier for ALL channels (empty array)", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-blacklist-1",
        type: "BLACKLIST",
        identifier: "+919999999999",
        channels: [],
        departmentIds: [],
      },
    });
    const r = await checkBlacklist({
      tenantId: "tenant-blacklist-1",
      channel: "WHATSAPP",
      sender: "+919999999999",
    });
    expect(r.blocked).toBe(true);
  });

  it("does NOT match when channels restrict to other channel", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-blacklist-2",
        type: "BLACKLIST",
        identifier: "spammer@x.com",
        channels: ["WHATSAPP"],
        departmentIds: [],
      },
    });
    const r = await checkBlacklist({
      tenantId: "tenant-blacklist-2",
      channel: "EMAIL",
      sender: "spammer@x.com",
    });
    expect(r.blocked).toBe(false);
  });

  it("does NOT match when expired", async () => {
    await prisma.spamRule.create({
      data: {
        tenantId: "tenant-blacklist-3",
        type: "BLACKLIST",
        identifier: "+918888888888",
        channels: [],
        departmentIds: [],
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await checkBlacklist({
      tenantId: "tenant-blacklist-3",
      channel: "WHATSAPP",
      sender: "+918888888888",
    });
    expect(r.blocked).toBe(false);
  });
});
