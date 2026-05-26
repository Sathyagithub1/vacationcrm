// src/modules/intake/dedup/race.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { dedupCheck } from "./index";

/**
 * Race-condition test for dedupCheck.
 *
 * dedupCheck is a read-only lookup — it only calls findFirst + creates a
 * LeadActivity on match. It does NOT create Customers. Customer creation
 * happens in dispatch (T31). This test proves that running two concurrent
 * dedupCheck calls against the same pre-seeded Customer:
 *   (a) leaves exactly 1 Customer row (dedup doesn't accidentally duplicate),
 *   (b) appends exactly 2 REPEAT_INQUIRY activities (both calls matched and
 *       recorded independently).
 *
 * The migration-006 partial unique index on (tenantId, mobile) guards against
 * duplicate Customer rows that would arise if dispatch were called twice
 * concurrently — that will be exercised once T31 (dispatch) lands.
 */

const TENANT_ID = "t-race";

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

let stageSeq = 0;
async function ensureStage(tenantId: string): Promise<string> {
  const id = `stage-${tenantId}-race-${++stageSeq}`;
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

async function seedCustomerWithLead(opts: {
  tenantId: string;
  mobile: string;
}): Promise<{ customerId: string; leadId: string }> {
  const stageId = await ensureStage(opts.tenantId);
  const customer = await prisma.customer.create({
    data: {
      tenantId: opts.tenantId,
      name: "Race Tester",
      mobile: opts.mobile,
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

function makePayload(
  tenantId: string,
  overrides: Partial<IntakePayload> = {}
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: { hello: "race" },
    sender: {},
    webhookLogId: "wh-race-1",
    ...overrides,
  };
}

describe("dedupCheck — concurrent intakes", () => {
  beforeEach(async () => {
    await ensureTenant(TENANT_ID);
    await clearTenant(TENANT_ID);
  });

  afterAll(async () => {
    await clearTenant(TENANT_ID);
    await prisma.$disconnect();
  });

  it("matches same customer without duplication when two calls race", async () => {
    const mobile = "+919000000001";

    // Seed one Customer + Lead before the concurrent calls.
    await seedCustomerWithLead({ tenantId: TENANT_ID, mobile });

    const payload = makePayload(TENANT_ID, {
      sender: { phone: mobile },
      canonicalFields: { phone: mobile },
    });

    // Fire two concurrent dedupCheck calls.
    const [out1, out2] = await Promise.all([
      dedupCheck(payload),
      dedupCheck(payload),
    ]);

    // Both should have matched the existing Lead.
    expect(out1.dedupResult?.existingLeadId).toBeDefined();
    expect(out2.dedupResult?.existingLeadId).toBeDefined();
    expect(out1.dedupResult?.existingLeadId).toBe(
      out2.dedupResult?.existingLeadId
    );

    // Exactly 1 Customer row — dedupCheck never creates Customers.
    const customers = await prisma.customer.findMany({
      where: { tenantId: TENANT_ID, mobile },
    });
    expect(customers).toHaveLength(1);

    // Both calls appended their own REPEAT_INQUIRY activity — count = 2.
    const activities = await prisma.leadActivity.findMany({
      where: { tenantId: TENANT_ID, type: "REPEAT_INQUIRY" },
    });
    expect(activities).toHaveLength(2);
  });
});
