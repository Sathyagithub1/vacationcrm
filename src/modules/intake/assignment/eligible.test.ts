// src/modules/intake/assignment/eligible.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getEligibleAgents } from "./eligible";

// ── Tenant / data constants ────────────────────────────────────────────────────
const T1 = "t-elig-1"; // active agents test
const T2 = "t-elig-2"; // inactive exclusion
const T3 = "t-elig-3"; // on-leave exclusion / inclusion
const T4 = "t-elig-4"; // empty dept
const T5 = "t-elig-5"; // cross-tenant isolation
const T6 = "t-elig-6"; // cross-tenant isolation (tenant B)
const DEPT_A = "dept-elig-a";
const DEPT_B = "dept-elig-b";

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
  isActive?: boolean;
  onLeaveUntil?: Date | null;
  languages?: string[];
  tags?: string[];
  assignmentTier?: number;
}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-elig-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-elig-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent ${seq}`,
      role: "AGENT",
      isActive: opts.isActive ?? true,
      departmentId: opts.departmentId ?? null,
      onLeaveUntil: opts.onLeaveUntil !== undefined ? opts.onLeaveUntil : null,
      languages: opts.languages ?? [],
      tags: opts.tags ?? [],
      assignmentTier: opts.assignmentTier ?? null,
    },
  });
  return id;
}

async function clearTenants(ids: string[]) {
  for (const t of ids) {
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

const ALL_TENANTS = [T1, T2, T3, T4, T5, T6];

describe("getEligibleAgents", () => {
  beforeEach(async () => {
    for (const t of ALL_TENANTS) await ensureTenant(t);
    await clearTenants(ALL_TENANTS);
  });

  afterAll(async () => {
    await clearTenants(ALL_TENANTS);
    await prisma.$disconnect();
  });

  it("returns active AGENTs in the specified department", async () => {
    await ensureDept(DEPT_A, T1);
    await ensureDept(DEPT_B, T1);
    const agentA = await createAgent({ tenantId: T1, departmentId: DEPT_A });
    const agentB = await createAgent({ tenantId: T1, departmentId: DEPT_A });
    // agent in a different dept should NOT appear
    await createAgent({ tenantId: T1, departmentId: DEPT_B });

    const result = await getEligibleAgents(T1, DEPT_A);
    const ids = result.map((a) => a.id).sort();
    expect(ids).toEqual([agentA, agentB].sort());
  });

  it("excludes agents with isActive === false", async () => {
    await ensureDept(DEPT_A, T2);
    const active = await createAgent({ tenantId: T2, departmentId: DEPT_A, isActive: true });
    await createAgent({ tenantId: T2, departmentId: DEPT_A, isActive: false });

    const result = await getEligibleAgents(T2, DEPT_A);
    expect(result.map((a) => a.id)).toEqual([active]);
  });

  it("excludes agents whose onLeaveUntil is in the future", async () => {
    await ensureDept(DEPT_A, T3);
    const notOnLeave = await createAgent({ tenantId: T3, departmentId: DEPT_A, onLeaveUntil: null });
    // on leave until tomorrow
    const future = new Date(Date.now() + 86_400_000);
    await createAgent({ tenantId: T3, departmentId: DEPT_A, onLeaveUntil: future });

    const result = await getEligibleAgents(T3, DEPT_A);
    expect(result.map((a) => a.id)).toEqual([notOnLeave]);
  });

  it("includes agents whose onLeaveUntil is in the past", async () => {
    await ensureDept(DEPT_A, T3);
    // past leave — should be included
    const past = new Date(Date.now() - 86_400_000);
    const returnedAgent = await createAgent({ tenantId: T3, departmentId: DEPT_A, onLeaveUntil: past });

    const result = await getEligibleAgents(T3, DEPT_A);
    expect(result.map((a) => a.id)).toContain(returnedAgent);
  });

  it("returns empty array when no agents exist in the department", async () => {
    await ensureDept(DEPT_A, T4);
    // no agents seeded
    const result = await getEligibleAgents(T4, DEPT_A);
    expect(result).toHaveLength(0);
  });

  it("does not return agents from another tenant (cross-tenant isolation)", async () => {
    await ensureDept(DEPT_A, T5);
    await ensureDept(DEPT_A, T6);
    // seed agent in T6 with same dept id
    await createAgent({ tenantId: T6, departmentId: DEPT_A });

    // query for T5 — should be empty
    const result = await getEligibleAgents(T5, DEPT_A);
    expect(result).toHaveLength(0);
  });
});
