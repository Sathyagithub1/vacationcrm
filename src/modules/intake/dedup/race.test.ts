// src/modules/intake/dedup/race.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { dedupCheck } from "./index";

/**
 * Back-to-back dedupCheck test.
 *
 * This test asserts that two `dedupCheck` calls executed back-to-back against
 * a pre-seeded customer both correctly match the existing Lead and each append
 * a REPEAT_INQUIRY activity — and that no Customer rows are created (since
 * dedupCheck is read+append-only). It does NOT prove atomicity of the
 * findFirst/create sequence at the DB level; the real concurrency guard for
 * Customer creation lives in migration 006's partial unique indexes and is
 * exercised at dispatch-time (Task 31).
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
