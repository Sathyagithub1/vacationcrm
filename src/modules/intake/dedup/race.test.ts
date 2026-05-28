// src/modules/intake/dedup/race.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { dedupCheck } from "./index";

/**
 * Concurrency tests for dedupCheck.
 *
 * Test 1 — Back-to-back match (pre-seeded customer):
 *   Two concurrent dedupCheck calls against a pre-seeded customer both match
 *   and append REPEAT_INQUIRY activities.  No duplicate Customer is created.
 *
 * Test 2 — Advisory-lock serialization (Phase 6e B7 fix):
 *   Two concurrent dedupCheck calls for the SAME phone where NO customer exists
 *   yet.  Without the lock both would pass dedupCheck and dispatch would create
 *   two Leads.  With the lock the second call waits for the first to commit,
 *   and when it runs it finds no customer (dedupCheck itself doesn't create
 *   customers) — so both still return no dedupResult.  The real protection is
 *   that the DISPATCH stage runs inside the same serialised window:  if dispatch
 *   commits a Customer+Lead between the two dedupCheck reads, the second dedup
 *   call finds it and short-circuits.
 *
 *   This test verifies that dedupCheck correctly acquires the advisory lock and
 *   does NOT throw, hang, or corrupt state when two concurrent calls share the
 *   same phone.  The end-to-end "only 1 Lead created" guarantee is validated in
 *   the load test (intake-burst-dedup.test.ts).
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

  it(
    "advisory lock: concurrent calls for same phone complete without error or deadlock",
    async () => {
      // No customer seeded — both calls will find nothing (no dedupResult).
      // The key assertion is that the advisory lock does NOT cause a deadlock,
      // hang, or error when two concurrent dedupCheck calls share the same phone.
      // Both should return cleanly with no dedupResult.
      const mobile = "+919000000002";

      const payload = makePayload(TENANT_ID, {
        sender: { phone: mobile },
        canonicalFields: { phone: mobile },
      });

      const results = await Promise.all([
        dedupCheck(payload),
        dedupCheck(payload),
      ]);

      // Neither call found an existing lead (no customer was seeded).
      // Both should complete without throwing.
      expect(results[0].dedupResult).toBeUndefined();
      expect(results[1].dedupResult).toBeUndefined();

      // No customers or leads were created — dedupCheck is read+append-only.
      const customers = await prisma.customer.count({
        where: { tenantId: TENANT_ID, mobile },
      });
      expect(customers).toBe(0);
    },
  );

  it(
    "advisory lock: second call for same phone detects lead created between lock acquisitions",
    async () => {
      // Simulate the real race: seed a Customer+Lead AFTER the first
      // dedupCheck acquires the lock but BEFORE it commits.
      // Since we can't inject mid-transaction, we verify the correct behaviour
      // sequentially: seed customer, then call dedupCheck — it should find it.
      const mobile = "+919000000003";

      // First call: no customer — passes through.
      const payloadBefore = makePayload(TENANT_ID, {
        sender: { phone: mobile },
        canonicalFields: { phone: mobile },
      });
      const out1 = await dedupCheck(payloadBefore);
      expect(out1.dedupResult).toBeUndefined();

      // Dispatch creates a Customer + Lead (simulated here directly).
      const { leadId } = await seedCustomerWithLead({ tenantId: TENANT_ID, mobile });

      // Second call: customer now exists — should detect it and return REPEAT_INQUIRY.
      const out2 = await dedupCheck(payloadBefore);
      expect(out2.dedupResult?.existingLeadId).toBe(leadId);

      const activities = await prisma.leadActivity.count({
        where: { tenantId: TENANT_ID, type: "REPEAT_INQUIRY" },
      });
      expect(activities).toBe(1);
    },
  );
});
