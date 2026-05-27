// src/modules/intake/assignment/strategies/named-pools.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { namedPools } from "./named-pools";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-np-1"; // source match selects pool A over pool B
const T2 = "t-np-2"; // department match selects pool
const T3 = "t-np-3"; // higher priority wins when both pools match
const T4 = "t-np-4"; // no pool matches → null
const T5 = "t-np-5"; // pool agentIds not eligible → skip to next
const DEPT_A = "dept-np-a";
const DEPT_B = "dept-np-b";

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
async function createAgent(opts: {
  tenantId: string;
  departmentId?: string;
}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-np-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-np-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent NP ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function createPool(opts: {
  tenantId: string;
  agentIds: string[];
  sourceMatch?: string[];
  departmentId?: string;
  priority?: number;
  isActive?: boolean;
}): Promise<string> {
  const pool = await prisma.assignmentPool.create({
    data: {
      tenantId: opts.tenantId,
      name: `Pool ${opts.tenantId}-${Date.now()}`,
      agentIds: opts.agentIds,
      sourceMatch: opts.sourceMatch ?? [],
      departmentId: opts.departmentId ?? null,
      priority: opts.priority ?? 0,
      isActive: opts.isActive ?? true,
    },
  });
  return pool.id;
}

async function clearAll() {
  for (const t of [T1, T2, T3, T4, T5]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.assignmentPool.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(
  tenantId: string,
  opts: { source?: IntakePayload["source"]; departmentId?: string } = {}
): IntakePayload {
  return {
    tenantId,
    source: opts.source ?? "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-np-1",
    departmentId: opts.departmentId,
  };
}

describe("namedPools strategy", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3, T4, T5]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("source match: META_LEAD_AD payload routes to pool A (priority 10), not pool B (priority 5)", async () => {
    const agentA = await createAgent({ tenantId: T1 });
    const agentB = await createAgent({ tenantId: T1 });
    await createPool({
      tenantId: T1,
      agentIds: [agentA],
      sourceMatch: ["META_LEAD_AD"],
      priority: 10,
    });
    await createPool({
      tenantId: T1,
      agentIds: [agentB],
      sourceMatch: ["WEBSITE"],
      priority: 5,
    });

    const result = await namedPools(
      makePayload(T1, { source: "META_LEAD_AD" })
    );
    expect(result).toBe(agentA);
  });

  it("department match: payload.departmentId matches pool.departmentId → pool selected", async () => {
    await ensureDept(DEPT_A, T2);
    const agentA = await createAgent({ tenantId: T2, departmentId: DEPT_A });
    await createPool({
      tenantId: T2,
      agentIds: [agentA],
      departmentId: DEPT_A,
      priority: 5,
    });

    const result = await namedPools(
      makePayload(T2, { departmentId: DEPT_A })
    );
    expect(result).toBe(agentA);
  });

  it("higher priority pool wins when both source and dept pools could match", async () => {
    await ensureDept(DEPT_A, T3);
    await ensureDept(DEPT_B, T3);
    const agentHigh = await createAgent({ tenantId: T3, departmentId: DEPT_A });
    const agentLow = await createAgent({ tenantId: T3, departmentId: DEPT_A });
    // Pool high: source match, priority 20
    await createPool({
      tenantId: T3,
      agentIds: [agentHigh],
      sourceMatch: ["FACEBOOK"],
      priority: 20,
    });
    // Pool low: dept match, priority 5
    await createPool({
      tenantId: T3,
      agentIds: [agentLow],
      departmentId: DEPT_A,
      priority: 5,
    });

    // payload source=FACEBOOK and departmentId=DEPT_A → both pools match, high wins
    const result = await namedPools(
      makePayload(T3, { source: "FACEBOOK", departmentId: DEPT_A })
    );
    expect(result).toBe(agentHigh);
  });

  it("no pool matches → returns null", async () => {
    await createAgent({ tenantId: T4 });
    await createPool({
      tenantId: T4,
      agentIds: [],
      sourceMatch: ["INSTAGRAM"],
      priority: 1,
    });

    // Source is WEBSITE — doesn't match INSTAGRAM pool; no dept pool either
    const result = await namedPools(makePayload(T4, { source: "WEBSITE" }));
    expect(result).toBeNull();
  });

  it("pool agentIds contain no eligible agents → skips to next pool", async () => {
    const ineligibleId = "non-existent-agent-np";
    const agentFallback = await createAgent({ tenantId: T5 });

    // Pool A (priority 10): agentIds has non-existent agent → skip
    await createPool({
      tenantId: T5,
      agentIds: [ineligibleId],
      sourceMatch: ["WEBSITE"],
      priority: 10,
    });
    // Pool B (priority 5): eligible agent → should be used
    await createPool({
      tenantId: T5,
      agentIds: [agentFallback],
      sourceMatch: ["WEBSITE"],
      priority: 5,
    });

    const result = await namedPools(makePayload(T5, { source: "WEBSITE" }));
    expect(result).toBe(agentFallback);
  });
});
