// src/modules/intake/assignment/cursor.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { nextAgentFromCursor } from "./cursor";

// ── Constants ──────────────────────────────────────────────────────────────────
const T = "t-cursor-1";
const T_WRAP = "t-cursor-wrap";
const T_CONC = "t-cursor-conc";
const SCOPE = "dept:test-scope";

// ── Helpers ────────────────────────────────────────────────────────────────────
async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function clearCursors(tenantIds: string[]) {
  for (const t of tenantIds) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
  }
}

const ALL_TENANTS = [T, T_WRAP, T_CONC];

describe("nextAgentFromCursor", () => {
  beforeEach(async () => {
    for (const t of ALL_TENANTS) await ensureTenant(t);
    await clearCursors(ALL_TENANTS);
  });

  afterAll(async () => {
    await clearCursors(ALL_TENANTS);
    await prisma.$disconnect();
  });

  it("distributes 6 sequential calls across 3 agents exactly 2/2/2", async () => {
    const agents = ["agent-c-1", "agent-c-2", "agent-c-3"].sort();
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const pick = await nextAgentFromCursor(T, SCOPE, agents);
      expect(pick).not.toBeNull();
      picks.push(pick!);
    }
    // Each agent picked exactly twice
    const counts = agents.map((a) => picks.filter((p) => p === a).length);
    expect(counts).toEqual([2, 2, 2]);
  });

  it("returns null when agentIds array is empty", async () => {
    const result = await nextAgentFromCursor(T, SCOPE, []);
    expect(result).toBeNull();
  });

  it("wraps correctly when lastAgentId is no longer in the list", async () => {
    const agents = ["a", "b", "c"];
    // Seed cursor pointing to a removed agent
    await prisma.assignmentCursor.create({
      data: { tenantId: T_WRAP, scope: "dept:wrap", lastAgentId: "agent-removed" },
    });
    const pick = await nextAgentFromCursor(T_WRAP, "dept:wrap", agents);
    // indexOf("agent-removed") === -1, so next = (−1+1)%3 = 0 → agents[0]
    expect(pick).toBe(agents[0]);
  });

  it("20 concurrent calls with 4 agents distributes exactly 5/5/5/5 (advisory lock serialises)", async () => {
    const agents = ["ca-1", "ca-2", "ca-3", "ca-4"].sort();
    // Run 20 concurrent calls
    const picks = await Promise.all(
      Array.from({ length: 20 }, () =>
        nextAgentFromCursor(T_CONC, "conc-scope", agents)
      )
    );

    // All picks must be valid agent ids
    expect(picks.every((p) => agents.includes(p!))).toBe(true);

    // Advisory lock serialises the calls → deterministic 5/5/5/5 distribution
    const counts = agents.map((a) => picks.filter((p) => p === a).length);
    expect(counts).toEqual([5, 5, 5, 5]);
  });
});
