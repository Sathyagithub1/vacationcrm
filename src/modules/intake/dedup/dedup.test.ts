// src/modules/intake/dedup/dedup.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { dedupCheck } from "./index";

const TENANTS = [
  "tenant-dedup-1",
  "tenant-dedup-2",
  "tenant-dedup-3",
  "tenant-dedup-4",
  "tenant-dedup-5",
  "tenant-dedup-6",
];

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

let stageSeq = 0;
async function ensureStage(tenantId: string): Promise<string> {
  const id = `stage-${tenantId}-${++stageSeq}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      name: "New",
      slug: `new-${id}`,
      position: 0,
      isDefault: true,
    },
  });
  return id;
}

async function clearTenant(tenantId: string) {
  await prisma.leadActivity.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId } });
}

async function clearAll() {
  for (const t of TENANTS) await clearTenant(t);
}

function makePayload(
  tenantId: string,
  overrides: Partial<IntakePayload> = {}
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: { hello: "world" },
    sender: {},
    webhookLogId: "wh-dedup-1",
    ...overrides,
  };
}

async function seedCustomerWithLead(opts: {
  tenantId: string;
  mobile: string;
  email?: string | null;
  name?: string;
}): Promise<{ customerId: string; leadId: string }> {
  const stageId = await ensureStage(opts.tenantId);
  const customer = await prisma.customer.create({
    data: {
      tenantId: opts.tenantId,
      name: opts.name ?? "Jane Doe",
      mobile: opts.mobile,
      email: opts.email ?? null,
    },
  });
  const lead = await prisma.lead.create({
    data: {
      tenantId: opts.tenantId,
      customerId: customer.id,
      stageId,
      source: "WEBSITE",
    },
  });
  return { customerId: customer.id, leadId: lead.id };
}

describe("dedupCheck", () => {
  beforeEach(async () => {
    for (const t of TENANTS) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("returns existing leadId on phone match within tenant", async () => {
    const tenantId = "tenant-dedup-1";
    const seeded = await seedCustomerWithLead({
      tenantId,
      mobile: "+919999000001",
      email: "jane@x.com",
    });

    const out = await dedupCheck(
      makePayload(tenantId, {
        sender: { phone: "+919999000001" },
        canonicalFields: { phone: "+919999000001" },
      })
    );

    expect(out.dedupResult?.existingLeadId).toBe(seeded.leadId);
    expect(out.dedupResult?.existingCustomerId).toBe(seeded.customerId);
  });

  it("returns existing leadId on email match within tenant", async () => {
    const tenantId = "tenant-dedup-2";
    const seeded = await seedCustomerWithLead({
      tenantId,
      mobile: "+919999000002",
      email: "match@x.com",
    });

    const out = await dedupCheck(
      makePayload(tenantId, {
        sender: { email: "match@x.com" },
        canonicalFields: { email: "match@x.com" },
      })
    );

    expect(out.dedupResult?.existingLeadId).toBe(seeded.leadId);
    expect(out.dedupResult?.existingCustomerId).toBe(seeded.customerId);
  });

  it("returns no match when phone and email differ", async () => {
    const tenantId = "tenant-dedup-3";
    await seedCustomerWithLead({
      tenantId,
      mobile: "+919999000003",
      email: "existing@x.com",
    });

    const out = await dedupCheck(
      makePayload(tenantId, {
        sender: { phone: "+919999999999", email: "other@x.com" },
        canonicalFields: { phone: "+919999999999", email: "other@x.com" },
      })
    );

    expect(out.dedupResult).toBeUndefined();
  });

  it("does NOT match across tenants", async () => {
    const tenantA = "tenant-dedup-4";
    const tenantB = "tenant-dedup-5";
    await seedCustomerWithLead({
      tenantId: tenantA,
      mobile: "+919999000004",
      email: "cross@x.com",
    });

    const out = await dedupCheck(
      makePayload(tenantB, {
        sender: { phone: "+919999000004", email: "cross@x.com" },
        canonicalFields: { phone: "+919999000004", email: "cross@x.com" },
      })
    );

    expect(out.dedupResult).toBeUndefined();
  });

  it("appends LeadActivity { type: REPEAT_INQUIRY } when match", async () => {
    const tenantId = "tenant-dedup-6";
    const seeded = await seedCustomerWithLead({
      tenantId,
      mobile: "+919999000006",
      email: null,
    });

    await dedupCheck(
      makePayload(tenantId, {
        source: "WHATSAPP",
        intakeFormId: undefined,
        sender: { phone: "+919999000006" },
        canonicalFields: { phone: "+919999000006" },
        rawPayload: { body: "Asking again about Bali tour" },
      })
    );

    const activities = await prisma.leadActivity.findMany({
      where: { tenantId, leadId: seeded.leadId },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("REPEAT_INQUIRY");
    const content = activities[0].content as Record<string, unknown>;
    expect(content.source).toBe("WHATSAPP");
    expect(content.intakeFormId).toBeNull();
    expect(content.rawPayload).toMatchObject({ body: "Asking again about Bali tour" });
  });
});
