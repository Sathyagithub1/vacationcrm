// src/modules/intake/assignment/strategies/round-robin.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { roundRobin } from "./round-robin";

// ── Constants ──────────────────────────────────────────────────────────────────
const T = "t-rr-1";
const T_EMPTY = "t-rr-empty";
const DEPT = "dept-rr-1";

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
  const id = `agent-rr-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-rr-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent RR ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function clearAll() {
  for (const t of [T, T_EMPTY]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(tenantId: string, departmentId?: string): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-rr-1",
    departmentId,
  };
}

describe("roundRobin strategy", () => {
  beforeEach(async () => {
    await ensureTenant(T);
    await ensureTenant(T_EMPTY);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("distributes 6 leads across 3 agents exactly 2/2/2", async () => {
    await ensureDept(DEPT, T);
    const a1 = await createAgent({ tenantId: T, departmentId: DEPT });
    const a2 = await createAgent({ tenantId: T, departmentId: DEPT });
    const a3 = await createAgent({ tenantId: T, departmentId: DEPT });
    const agents = [a1, a2, a3].sort();

    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const pick = await roundRobin(makePayload(T, DEPT));
      expect(pick).not.toBeNull();
      picks.push(pick!);
    }

    const counts = agents.map((a) => picks.filter((p) => p === a).length);
    expect(counts).toEqual([2, 2, 2]);
  });

  it("returns null when no eligible agents exist in the department", async () => {
    await ensureDept(DEPT, T_EMPTY);
    const result = await roundRobin(makePayload(T_EMPTY, DEPT));
    expect(result).toBeNull();
  });
});
