// src/modules/intake/assignment/strategies/ai-tiered.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { aiTiered } from "./ai-tiered";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-at-1"; // score=85 → tier 1
const T2 = "t-at-2"; // no lead score → lowest tier
const T3 = "t-at-3"; // tier 1 empty → cascade to tier 2
const T4 = "t-at-4"; // all tiers empty → null
const DEPT = "dept-at-1";

// Standard config: tierCount=3, cutoffs=[80,40] (sorted DESC)
const TIER_CONFIG = { tierCount: 3, cutoffs: [80, 40] };

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

async function upsertStrategy(tenantId: string, config: Record<string, unknown>) {
  await prisma.assignmentStrategy.upsert({
    where: { tenantId },
    update: { config },
    create: { tenantId, type: "AI_TIERED", config },
  });
}

let userSeq = 0;
async function createAgent(opts: {
  tenantId: string;
  departmentId?: string;
  assignmentTier?: number;
}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-at-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-at-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent AT ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
      assignmentTier: opts.assignmentTier ?? null,
    },
  });
  return id;
}

let custSeq = 0;
async function createCustomer(tenantId: string): Promise<string> {
  const seq = ++custSeq;
  const c = await prisma.customer.create({
    data: {
      tenantId,
      name: `Customer AT ${seq}`,
      mobile: `+91800000${String(seq).padStart(4, "0")}`,
    },
  });
  return c.id;
}

let stageSeq = 0;
async function ensureStage(tenantId: string): Promise<string> {
  const id = `stage-at-${++stageSeq}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: "new", slug: "new", position: stageSeq, isDefault: true },
  });
  return id;
}

async function createLeadWithScore(opts: {
  tenantId: string;
  score: number;
}): Promise<string> {
  const customerId = await createCustomer(opts.tenantId);
  const stageId = await ensureStage(opts.tenantId);
  const lead = await prisma.lead.create({
    data: {
      tenantId: opts.tenantId,
      customerId,
      stageId,
      source: "WEBSITE",
    },
  });
  await prisma.leadScore.create({
    data: {
      tenantId: opts.tenantId,
      leadId: lead.id,
      score: opts.score,
      tier: "HOT",
    },
  });
  return lead.id;
}

async function createLeadNoScore(tenantId: string): Promise<string> {
  const customerId = await createCustomer(tenantId);
  const stageId = await ensureStage(tenantId);
  const lead = await prisma.lead.create({
    data: { tenantId, customerId, stageId, source: "WEBSITE" },
  });
  return lead.id;
}

async function clearAll() {
  for (const t of [T1, T2, T3, T4]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.leadScore.deleteMany({ where: { tenantId: t } });
    await prisma.leadActivity.deleteMany({ where: { tenantId: t } });
    await prisma.lead.deleteMany({ where: { tenantId: t } });
    await prisma.customer.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.pipelineStage.deleteMany({ where: { tenantId: t } });
    await prisma.assignmentStrategy.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(tenantId: string, leadId?: string): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-at-1",
    departmentId: DEPT,
    leadId,
  };
}

describe("aiTiered strategy", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3, T4]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("score=85 with cutoffs=[80,40] → tier 1 agent picked", async () => {
    await ensureDept(DEPT, T1);
    await upsertStrategy(T1, TIER_CONFIG);
    const tier1Agent = await createAgent({ tenantId: T1, departmentId: DEPT, assignmentTier: 1 });
    await createAgent({ tenantId: T1, departmentId: DEPT, assignmentTier: 2 });
    const leadId = await createLeadWithScore({ tenantId: T1, score: 85 });

    const result = await aiTiered(makePayload(T1, leadId));
    expect(result).toBe(tier1Agent);
  });

  it("no LeadScore row → falls back to lowest tier (tier 3)", async () => {
    await ensureDept(DEPT, T2);
    await upsertStrategy(T2, TIER_CONFIG);
    await createAgent({ tenantId: T2, departmentId: DEPT, assignmentTier: 1 });
    await createAgent({ tenantId: T2, departmentId: DEPT, assignmentTier: 2 });
    const tier3Agent = await createAgent({ tenantId: T2, departmentId: DEPT, assignmentTier: 3 });
    const leadId = await createLeadNoScore(T2);

    const result = await aiTiered(makePayload(T2, leadId));
    expect(result).toBe(tier3Agent);
  });

  it("tier 1 pool empty → cascades to tier 2", async () => {
    await ensureDept(DEPT, T3);
    await upsertStrategy(T3, TIER_CONFIG);
    // No tier-1 agent; only tier-2 present
    const tier2Agent = await createAgent({ tenantId: T3, departmentId: DEPT, assignmentTier: 2 });
    const leadId = await createLeadWithScore({ tenantId: T3, score: 90 }); // would be tier 1

    const result = await aiTiered(makePayload(T3, leadId));
    expect(result).toBe(tier2Agent);
  });

  it("all tiers empty (no assignmentTier set) → returns null", async () => {
    await ensureDept(DEPT, T4);
    await upsertStrategy(T4, TIER_CONFIG);
    // Agent with no assignmentTier (null) — won't match tier 1, 2, or 3
    await createAgent({ tenantId: T4, departmentId: DEPT, assignmentTier: undefined });
    const leadId = await createLeadWithScore({ tenantId: T4, score: 50 });

    const result = await aiTiered(makePayload(T4, leadId));
    expect(result).toBeNull();
  });
});
