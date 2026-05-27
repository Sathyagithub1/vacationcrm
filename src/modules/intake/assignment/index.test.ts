// src/modules/intake/assignment/index.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { assignLead } from "./index";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-asgn-1"; // no leadId → throws
const T2 = "t-asgn-2"; // ROUND_ROBIN strategy → picks agent, updates lead, writes activity
const T3 = "t-asgn-3"; // no strategy → falls back, activity has strategy=NONE
const T4 = "t-asgn-4"; // NAMED_POOLS with no matching pool → falls back
const DEPT = "dept-asgn-1";

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

let stageSeq = 0;
async function ensureStage(tenantId: string): Promise<string> {
  const id = `stage-asgn-${++stageSeq}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: "new", slug: "new", position: stageSeq, isDefault: true },
  });
  return id;
}

let custSeq = 0;
async function createCustomer(tenantId: string): Promise<string> {
  const seq = ++custSeq;
  const c = await prisma.customer.create({
    data: {
      tenantId,
      name: `Customer ASGN ${seq}`,
      mobile: `+91700000${String(seq).padStart(4, "0")}`,
    },
  });
  return c.id;
}

async function createLead(tenantId: string, departmentId?: string): Promise<string> {
  const stageId = await ensureStage(tenantId);
  const customerId = await createCustomer(tenantId);
  const lead = await prisma.lead.create({
    data: {
      tenantId,
      customerId,
      stageId,
      source: "WEBSITE",
      departmentId: departmentId ?? null,
    },
  });
  return lead.id;
}

let userSeq = 0;
async function createAgent(opts: {
  tenantId: string;
  departmentId?: string;
}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-asgn-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-asgn-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent ASGN ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function createAdmin(tenantId: string): Promise<string> {
  const seq = ++userSeq;
  const id = `admin-asgn-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId,
      email: `admin-asgn-${seq}@test.com`,
      passwordHash: "x",
      name: `Admin ASGN ${seq}`,
      role: "COMPANY_ADMIN",
      isActive: true,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function upsertStrategy(
  tenantId: string,
  type: "ROUND_ROBIN" | "LOAD_BALANCED" | "SKILL_BASED" | "AI_TIERED" | "NAMED_POOLS",
  config: Record<string, unknown> = {}
) {
  await prisma.assignmentStrategy.upsert({
    where: { tenantId },
    update: { type, config },
    create: { tenantId, type, config },
  });
}

async function clearAll() {
  for (const t of [T1, T2, T3, T4]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.notification.deleteMany({ where: { tenantId: t } });
    await prisma.leadActivity.deleteMany({ where: { tenantId: t } });
    await prisma.leadScore.deleteMany({ where: { tenantId: t } });
    await prisma.lead.deleteMany({ where: { tenantId: t } });
    await prisma.customer.deleteMany({ where: { tenantId: t } });
    await prisma.assignmentPool.deleteMany({ where: { tenantId: t } });
    await prisma.assignmentStrategy.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.pipelineStage.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(
  tenantId: string,
  leadId?: string,
  opts: { departmentId?: string } = {}
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-asgn-1",
    departmentId: opts.departmentId,
    leadId,
  };
}

describe("assignLead orchestrator", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3, T4]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("throws when payload.leadId is absent", async () => {
    await expect(assignLead(makePayload(T1))).rejects.toThrow(
      "assignLead: leadId required"
    );
  });

  it("ROUND_ROBIN strategy: picks eligible agent, updates Lead.assignedTo, writes ASSIGNMENT activity", async () => {
    await ensureDept(DEPT, T2);
    await upsertStrategy(T2, "ROUND_ROBIN");
    const agentId = await createAgent({ tenantId: T2, departmentId: DEPT });
    const leadId = await createLead(T2, DEPT);

    await assignLead(makePayload(T2, leadId, { departmentId: DEPT }));

    // Lead should be assigned to the agent
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.assignedTo).toBe(agentId);

    // ASSIGNMENT activity should exist with correct content
    const activity = await prisma.leadActivity.findFirst({
      where: { tenantId: T2, leadId, type: "ASSIGNMENT" },
    });
    expect(activity).not.toBeNull();
    const content = activity?.content as Record<string, unknown>;
    expect(content.strategy).toBe("ROUND_ROBIN");
    expect(content.assigneeId).toBe(agentId);
  });

  it("no strategy configured → falls back, activity has strategy=NONE, reason=fallback:dept-rr or fallback:company-admin", async () => {
    await ensureDept(DEPT, T3);
    // No AssignmentStrategy row
    const agentId = await createAgent({ tenantId: T3, departmentId: DEPT });
    const leadId = await createLead(T3, DEPT);

    await assignLead(makePayload(T3, leadId, { departmentId: DEPT }));

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.assignedTo).toBe(agentId);

    const activity = await prisma.leadActivity.findFirst({
      where: { tenantId: T3, leadId, type: "ASSIGNMENT" },
    });
    expect(activity).not.toBeNull();
    const content = activity?.content as Record<string, unknown>;
    expect(content.strategy).toBe("NONE");
    expect(
      content.reason === "fallback:dept-rr" || content.reason === "fallback:company-admin"
    ).toBe(true);
  });

  it("NAMED_POOLS strategy with no matching pool → falls back to COMPANY_ADMIN, writes activity", async () => {
    await ensureDept(DEPT, T4);
    await upsertStrategy(T4, "NAMED_POOLS");
    // No pool rows for T4 — namedPools() will return null
    // Seed COMPANY_ADMIN as the fallback target (no eligible AGENTs)
    const adminId = await createAdmin(T4);
    const leadId = await createLead(T4, DEPT);

    await assignLead(makePayload(T4, leadId, { departmentId: DEPT }));

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.assignedTo).toBe(adminId);

    const activity = await prisma.leadActivity.findFirst({
      where: { tenantId: T4, leadId, type: "ASSIGNMENT" },
    });
    expect(activity).not.toBeNull();
    const content = activity?.content as Record<string, unknown>;
    expect(content.strategy).toBe("NAMED_POOLS");
    expect(content.reason).toBe("fallback:company-admin");
  });
});
