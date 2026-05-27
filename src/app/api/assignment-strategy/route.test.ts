/**
 * src/app/api/assignment-strategy/route.test.ts
 *
 * T36 tests — Assignment strategy GET/PUT.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, PUT } from "./route";

const T_ADMIN = "t-astrat-admin";
const T_AGENT = "t-astrat-agent";
const T_OTHER = "t-astrat-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function clearTenant(t: string) {
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assignment-strategy", {
    method: "PUT",
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

describe("T36 Assignment strategy GET/PUT", () => {

  it("GET returns null when no strategy configured", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.strategy).toBeNull();
  });

  it("PUT ROUND_ROBIN → 200, GET returns strategy", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const putRes = await PUT(putReq({ type: "ROUND_ROBIN", config: {} }));
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json() as Record<string, unknown>;
    expect((putJson.strategy as Record<string, unknown>).type).toBe("ROUND_ROBIN");

    const getRes = await GET();
    const getJson = await getRes.json() as Record<string, unknown>;
    expect((getJson.strategy as Record<string, unknown>).type).toBe("ROUND_ROBIN");
  });

  it("PUT AI_TIERED validates lowCutoff < highCutoff", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Valid
    const valid = await PUT(putReq({ type: "AI_TIERED", config: { lowCutoff: 0.3, highCutoff: 0.7 } }));
    expect(valid.status).toBe(200);

    // Invalid: lowCutoff >= highCutoff
    const invalid = await PUT(putReq({ type: "AI_TIERED", config: { lowCutoff: 0.8, highCutoff: 0.5 } }));
    expect(invalid.status).toBe(400);
    const json = await invalid.json() as Record<string, unknown>;
    expect(json.error).toMatch(/less than/i);
  });

  it("PUT AI_TIERED missing cutoffs → 400", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await PUT(putReq({ type: "AI_TIERED", config: {} }));
    expect(res.status).toBe(400);
  });

  it("PUT invalid type → 400", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await PUT(putReq({ type: "BOGUS_TYPE" }));
    expect(res.status).toBe(400);
  });

  it("AGENT role → 403 on PUT", async () => {
    await prisma.user.upsert({
      where: { id: `u-${T_AGENT}` }, update: {},
      create: { id: `u-${T_AGENT}`, tenantId: T_AGENT, email: `u@${T_AGENT}.com`, passwordHash: "x", name: "Agent", role: "AGENT", isActive: true, languages: [], tags: [] },
    });
    setSession(T_AGENT, "AGENT");
    const res = await PUT(putReq({ type: "ROUND_ROBIN" }));
    expect(res.status).toBe(403);
  });

  it("tenant isolation: tenant B PUT does not overwrite tenant A strategy", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    await PUT(putReq({ type: "ROUND_ROBIN" }));

    setSession(T_OTHER, "COMPANY_ADMIN");
    await PUT(putReq({ type: "LOAD_BALANCED" }));

    // Tenant A strategy must still be ROUND_ROBIN
    const stratA = await prisma.assignmentStrategy.findFirst({ where: { tenantId: T_ADMIN } });
    expect(stratA?.type).toBe("ROUND_ROBIN");
    const stratB = await prisma.assignmentStrategy.findFirst({ where: { tenantId: T_OTHER } });
    expect(stratB?.type).toBe("LOAD_BALANCED");
  });
});
