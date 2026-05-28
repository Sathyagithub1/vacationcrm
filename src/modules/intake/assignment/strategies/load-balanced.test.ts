// src/modules/intake/assignment/strategies/load-balanced.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { loadBalanced } from "./load-balanced";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-lb-1"; // agent with fewest wins
const T2 = "t-lb-2"; // LRA tiebreaker
const T3 = "t-lb-3"; // WON leads excluded
const T4 = "t-lb-4"; // no eligible agents
const T5 = "t-lb-5"; // concurrent advisory-lock test
const DEPT = "dept-lb-1";

// ── Helpers ────────────────────────────────────────────────────────────────────
async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function ensureDept(id: string, tenantId: string) {
  await prisma.department.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: id, slug: id },
  });
}

let userSeq = 0;
async function createAgent(opts: { tenantId: string; departmentId?: string }): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-lb-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-lb-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent LB ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

let stageSeq = 0;
async function ensureStage(tenantId: string, slug: string): Promise<string> {
  const id = `stage-lb-${++stageSeq}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: slug, slug, position: stageSeq, isDefault: slug === "new" },
  });
  return id;
}

let custSeq = 0;
async function createCustomer(tenantId: string): Promise<string> {
  const seq = ++custSeq;
  const c = await prisma.customer.create({
    data: {
      tenantId,
      name: `Customer LB ${seq}`,
      mobile: `+91900000${String(seq).padStart(4, "0")}`,
    },
  });
  return c.id;
}

async function createLead(opts: {
  tenantId: string;
  stageId: string;
  assignedTo: string;
  updatedAt?: Date;
}): Promise<string> {
  const customerId = await createCustomer(opts.tenantId);
  const lead = await prisma.lead.create({
    data: {
      tenantId: opts.tenantId,
      customerId,
      stageId: opts.stageId,
      source: "WEBSITE",
      assignedTo: opts.assignedTo,
    },
  });
  if (opts.updatedAt) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { updatedAt: opts.updatedAt },
    });
  }
  return lead.id;
}

async function clearAll() {
  for (const t of [T1, T2, T3, T4, T5]) {
    await prisma.leadActivity.deleteMany({ where: { tenantId: t } });
    await prisma.lead.deleteMany({ where: { tenantId: t } });
    await prisma.customer.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.pipelineStage.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(tenantId: string, departmentId?: string): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-lb-1",
    departmentId,
  };
}

describe("loadBalanced strategy", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3, T4, T5]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("picks the agent with the fewest open leads (C=0, B=2, A=1 → C wins)", async () => {
    await ensureDept(DEPT, T1);
    const openStage = await ensureStage(T1, "new");

    const agentA = await createAgent({ tenantId: T1, departmentId: DEPT });
    const agentB = await createAgent({ tenantId: T1, departmentId: DEPT });
    const agentC = await createAgent({ tenantId: T1, departmentId: DEPT });

    // A has 1 open lead, B has 2, C has 0
    await createLead({ tenantId: T1, stageId: openStage, assignedTo: agentA });
    await createLead({ tenantId: T1, stageId: openStage, assignedTo: agentB });
    await createLead({ tenantId: T1, stageId: openStage, assignedTo: agentB });

    const result = await loadBalanced(makePayload(T1, DEPT));
    expect(result).toBe(agentC);
  });

  it("breaks ties by least-recent-activity (A has older updatedAt → A wins)", async () => {
    await ensureDept(DEPT, T2);
    const openStage = await ensureStage(T2, "new");

    const agentA = await createAgent({ tenantId: T2, departmentId: DEPT });
    const agentB = await createAgent({ tenantId: T2, departmentId: DEPT });

    // Both A and B have 1 open lead each, but A's lead has an older updatedAt
    const olderDate = new Date("2025-01-01T00:00:00Z");
    const newerDate = new Date("2025-06-01T00:00:00Z");
    await createLead({ tenantId: T2, stageId: openStage, assignedTo: agentA, updatedAt: olderDate });
    await createLead({ tenantId: T2, stageId: openStage, assignedTo: agentB, updatedAt: newerDate });

    const result = await loadBalanced(makePayload(T2, DEPT));
    expect(result).toBe(agentA);
  });

  it("excludes WON leads from open count (A has 5 WON → treated same as B with 1 open → B should win as lighter)", async () => {
    await ensureDept(DEPT, T3);
    const openStage = await ensureStage(T3, "new");
    const wonStage = await ensureStage(T3, "won");

    const agentA = await createAgent({ tenantId: T3, departmentId: DEPT });
    const agentB = await createAgent({ tenantId: T3, departmentId: DEPT });

    // Agent A: 5 WON leads (not open) + 0 open → 0 open count
    for (let i = 0; i < 5; i++) {
      await createLead({ tenantId: T3, stageId: wonStage, assignedTo: agentA });
    }

    // Agent B: 1 open lead
    await createLead({ tenantId: T3, stageId: openStage, assignedTo: agentB });

    // A has 0 open, B has 1 open → A wins
    const result = await loadBalanced(makePayload(T3, DEPT));
    expect(result).toBe(agentA);
  });

  it("returns null when no eligible agents exist", async () => {
    await ensureDept(DEPT, T4);
    // no agents seeded
    const result = await loadBalanced(makePayload(T4, DEPT));
    expect(result).toBeNull();
  });

  it(
    "advisory lock: reliably picks agent with 0 open leads under 10 concurrent calls",
    { timeout: 30000 },
    async () => {
      // Phase 6e B8 test: seed 3 agents where agent A has 5 open leads,
      // agent B has 3 open leads, and agent C has 0 open leads.
      // Under 10 concurrent calls, every call should pick agent C (fewest open).
      // Without the advisory lock many calls would see the same "all tied at 0"
      // snapshot and diverge.  With the lock they serialise and each call reads
      // sequentially-committed counts — C is always the winner.
      //
      // Note: in this test no Lead.assignedTo writes happen between calls
      // (we're testing the strategy in isolation, not the full orchestrator),
      // so the open-lead count for C remains 0 throughout — all 10 calls should
      // return agent C.
      await ensureDept(DEPT, T5);
      const openStage = await ensureStage(T5, "new");

      const agentA = await createAgent({ tenantId: T5, departmentId: DEPT });
      const agentB = await createAgent({ tenantId: T5, departmentId: DEPT });
      const agentC = await createAgent({ tenantId: T5, departmentId: DEPT });

      // Agent A: 5 open leads
      for (let i = 0; i < 5; i++) {
        await createLead({ tenantId: T5, stageId: openStage, assignedTo: agentA });
      }
      // Agent B: 3 open leads
      for (let i = 0; i < 3; i++) {
        await createLead({ tenantId: T5, stageId: openStage, assignedTo: agentB });
      }
      // Agent C: 0 open leads — should always win

      const payload = makePayload(T5, DEPT);

      // Run 10 concurrent calls — all should pick agent C
      const results = await Promise.all(
        Array.from({ length: 10 }, () => loadBalanced(payload)),
      );

      for (const result of results) {
        expect(result).toBe(agentC);
      }
    },
  );
});
