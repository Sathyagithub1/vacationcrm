/**
 * src/app/api/assignment-pools/route.test.ts
 *
 * T37 tests — Assignment pools CRUD.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, POST } from "./route";

const T_ADMIN = "t-apool-admin";
const T_AGENT = "t-apool-agent";
const T_OTHER = "t-apool-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function seedAgent(tenantId: string, seq: number): Promise<string> {
  const id = `agent-apool-${tenantId}-${seq}`;
  await prisma.user.upsert({
    where: { id }, update: {},
    create: { id, tenantId, email: `agent${seq}@${tenantId}.com`, passwordHash: "x", name: `Agent ${seq}`, role: "AGENT", isActive: true, languages: [], tags: [] },
  });
  return id;
}

async function clearTenant(t: string) {
  await prisma.assignmentPool.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assignment-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  for (const t of [T_ADMIN, T_AGENT, T_OTHER]) {
    await prisma.tenant.upsert({ where: { id: t }, update: {}, create: { id: t, name: t, slug: t } });
    await clearTenant(t);
  }
  for (const t of [T_ADMIN, T_OTHER]) {
    await prisma.user.upsert({
      where: { id: `u-${t}` }, update: {},
      create: { id: `u-${t}`, tenantId: t, email: `u@${t}.com`, passwordHash: "x", name: "A", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
  }
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_AGENT, T_OTHER]) await clearTenant(t);
  await prisma.$disconnect();
});

describe("T37 Assignment pools CRUD", () => {

  it("POST creates pool with valid agentIds → 201 with pool", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const agentId = await seedAgent(T_ADMIN, 1);

    const res = await POST(postReq({
      name: "WhatsApp Specialists",
      agentIds: [agentId],
      priority: 10,
      sourceMatch: ["WHATSAPP"],
    }));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    const pool = json.pool as Record<string, unknown>;
    expect(pool.name).toBe("WhatsApp Specialists");
    expect(pool.priority).toBe(10);
    expect((pool.agentIds as string[]).includes(agentId)).toBe(true);
  });

  it("POST rejects agentIds that are not AGENT role users of this tenant", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Use a user ID that doesn't exist or belongs to wrong tenant
    const res = await POST(postReq({
      name: "Invalid Pool",
      agentIds: ["fake-agent-id-xyz"],
    }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/fake-agent-id-xyz/);
  });

  it("GET returns pools ordered by priority desc", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const a1 = await seedAgent(T_ADMIN, 2);
    const a2 = await seedAgent(T_ADMIN, 3);

    await POST(postReq({ name: "Low", agentIds: [a1], priority: 1 }));
    await POST(postReq({ name: "High", agentIds: [a2], priority: 99 }));

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    const pools = json.pools as Array<Record<string, unknown>>;
    expect(pools[0].name).toBe("High");
    expect(pools[1].name).toBe("Low");
  });

  it("AGENT role → 403 on POST", async () => {
    await prisma.user.upsert({
      where: { id: `u-${T_AGENT}` }, update: {},
      create: { id: `u-${T_AGENT}`, tenantId: T_AGENT, email: `u@${T_AGENT}.com`, passwordHash: "x", name: "A", role: "AGENT", isActive: true, languages: [], tags: [] },
    });
    setSession(T_AGENT, "AGENT");

    const res = await POST(postReq({ name: "Pool", agentIds: [] }));
    expect(res.status).toBe(403);
  });

  it("tenant isolation: tenant B list does not include tenant A pools", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const a1 = await seedAgent(T_ADMIN, 4);
    await POST(postReq({ name: "Tenant A Pool", agentIds: [a1] }));

    setSession(T_OTHER, "COMPANY_ADMIN");
    const res = await GET();
    const json = await res.json() as Record<string, unknown>;
    const pools = json.pools as Array<Record<string, unknown>>;
    expect(pools.every((p) => p.name !== "Tenant A Pool")).toBe(true);
  });
});
