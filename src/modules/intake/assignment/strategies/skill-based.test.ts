// src/modules/intake/assignment/strategies/skill-based.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { skillBased } from "./skill-based";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-sb-1"; // language filter
const T2 = "t-sb-2"; // tag filter
const T3 = "t-sb-3"; // no match → fallback to base pool
const T4 = "t-sb-4"; // no criteria → use full base pool
const T5 = "t-sb-5"; // OR semantics: language-only OR tag-only match
const DEPT = "dept-sb-1";

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
  languages?: string[];
  tags?: string[];
}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-sb-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `agent-sb-${seq}@test.com`,
      passwordHash: "x",
      name: `Agent SB ${seq}`,
      role: "AGENT",
      isActive: true,
      departmentId: opts.departmentId ?? null,
      languages: opts.languages ?? [],
      tags: opts.tags ?? [],
    },
  });
  return id;
}

async function clearAll() {
  for (const t of [T1, T2, T3, T4, T5]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

function makePayload(
  tenantId: string,
  opts: { departmentId?: string; language?: string; tags?: string[] } = {}
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-sb-1",
    departmentId: opts.departmentId,
    canonicalFields: {
      ...(opts.language !== undefined ? { language: opts.language } : {}),
      ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
    },
  };
}

describe("skillBased strategy", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3, T4, T5]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("picks only the agent who speaks the requested language", async () => {
    await ensureDept(DEPT, T1);
    const agentA = await createAgent({ tenantId: T1, departmentId: DEPT, languages: ["en"] });
    await createAgent({ tenantId: T1, departmentId: DEPT, languages: ["es"] });

    const result = await skillBased(makePayload(T1, { departmentId: DEPT, language: "en" }));
    expect(result).toBe(agentA);
  });

  it("picks only the agent whose tags include the requested tag", async () => {
    await ensureDept(DEPT, T2);
    const agentA = await createAgent({ tenantId: T2, departmentId: DEPT, tags: ["luxury"] });
    await createAgent({ tenantId: T2, departmentId: DEPT, tags: ["budget"] });

    const result = await skillBased(makePayload(T2, { departmentId: DEPT, tags: ["luxury"] }));
    expect(result).toBe(agentA);
  });

  it("falls back to base round-robin when no agent matches language or tags", async () => {
    await ensureDept(DEPT, T3);
    const agentA = await createAgent({ tenantId: T3, departmentId: DEPT, languages: ["fr"] });
    const agentB = await createAgent({ tenantId: T3, departmentId: DEPT, languages: ["de"] });

    // Request "en" — neither agent speaks it; both should be in pool
    const result = await skillBased(makePayload(T3, { departmentId: DEPT, language: "en" }));
    expect(result === agentA || result === agentB).toBe(true);
  });

  it("uses full base pool when neither language nor tags are present on payload", async () => {
    await ensureDept(DEPT, T4);
    const agentA = await createAgent({ tenantId: T4, departmentId: DEPT, languages: ["zh"] });
    const agentB = await createAgent({ tenantId: T4, departmentId: DEPT, languages: ["ar"] });

    // No canonicalFields criteria at all → full pool → round-robin across both
    const result = await skillBased(makePayload(T4, { departmentId: DEPT }));
    expect(result === agentA || result === agentB).toBe(true);
  });

  it("OR semantics: picks agent matching ONLY language and agent matching ONLY tag independently", async () => {
    await ensureDept(DEPT, T5);
    // agentA speaks "ja" but has no matching tags
    const agentA = await createAgent({ tenantId: T5, departmentId: DEPT, languages: ["ja"], tags: [] });
    // agentB has tag "vip" but speaks no matching language
    const agentB = await createAgent({ tenantId: T5, departmentId: DEPT, languages: [], tags: ["vip"] });
    // agentC has neither
    await createAgent({ tenantId: T5, departmentId: DEPT, languages: [], tags: [] });

    // Both A (language match) and B (tag match) qualify; C does not.
    const picks = new Set<string>();
    // Run 4 times; only agentA and agentB should ever appear
    for (let i = 0; i < 4; i++) {
      const r = await skillBased(makePayload(T5, { departmentId: DEPT, language: "ja", tags: ["vip"] }));
      expect(r).not.toBeNull();
      picks.add(r!);
    }
    expect(picks.has(agentA)).toBe(true);
    expect(picks.has(agentB)).toBe(true);
    // agentC (no match) must never be picked
    expect(picks.has(`agent-sb-${userSeq}`)).toBe(false);
  });
});
