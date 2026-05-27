/**
 * src/app/api/users/agents/route.test.ts
 *
 * T38 tests — Agents picker endpoint.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET } from "./route";

const T_ADMIN = "t-agpick-admin";
const T_OTHER = "t-agpick-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

let userSeq = 0;
async function seedAgent(tenantId: string, opts: { isActive?: boolean; departmentId?: string } = {}): Promise<string> {
  const seq = ++userSeq;
  const id = `agent-agpick-${seq}`;
  await prisma.user.create({
    data: {
      id, tenantId,
      email: `agent${seq}@${tenantId}.com`,
      passwordHash: "x",
      name: `Agent ${seq}`,
      role: "AGENT",
      isActive: opts.isActive ?? true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function seedDept(tenantId: string): Promise<string> {
  const id = `dept-agpick-${tenantId}`;
  await prisma.department.upsert({
    where: { id }, update: {},
    create: { id, tenantId, name: "Dept", slug: `dept-${tenantId}` },
  });
  return id;
}

async function clearTenant(t: string) {
  await prisma.lead.deleteMany({ where: { tenantId: t } });
  await prisma.customer.deleteMany({ where: { tenantId: t } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
  await prisma.department.deleteMany({ where: { tenantId: t } });
}

function getReq(qs = ""): NextRequest {
  return new NextRequest(`http://localhost/api/users/agents${qs}`);
}

beforeEach(async () => {
  for (const t of [T_ADMIN, T_OTHER]) {
    await prisma.tenant.upsert({ where: { id: t }, update: {}, create: { id: t, name: t, slug: t } });
    await clearTenant(t);
    await prisma.user.upsert({
      where: { id: `u-${t}` }, update: {},
      create: { id: `u-${t}`, tenantId: t, email: `u@${t}.com`, passwordHash: "x", name: "Admin", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
  }
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_OTHER]) await clearTenant(t);
  await prisma.$disconnect();
});

describe("T38 Agents picker endpoint", () => {

  it("returns only active AGENT users with id, name, email, departmentId, openLeadCount, lastSeenAt", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const agentId = await seedAgent(T_ADMIN, { isActive: true });
    await seedAgent(T_ADMIN, { isActive: false }); // inactive — must not appear

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    const agents = json.agents as Array<Record<string, unknown>>;

    // Only the active agent
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe(agentId);
    expect("openLeadCount" in agents[0]).toBe(true);
    expect("lastSeenAt" in agents[0]).toBe(true);
    expect(typeof agents[0].openLeadCount).toBe("number");
  });

  it("filters by departmentId when provided", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);
    const agentWithDept    = await seedAgent(T_ADMIN, { departmentId: deptId });
    await seedAgent(T_ADMIN, {}); // no dept

    const res = await GET(getReq(`?departmentId=${deptId}`));
    const json = await res.json() as Record<string, unknown>;
    const agents = json.agents as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe(agentWithDept);
  });

  it("openLeadCount reflects number of assigned leads", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const agentId = await seedAgent(T_ADMIN);

    // Seed 2 leads assigned to this agent
    const stageId = `stage-agpick-${T_ADMIN}`;
    await prisma.pipelineStage.upsert({
      where: { id: stageId }, update: {},
      create: { id: stageId, tenantId: T_ADMIN, name: "New", slug: "new", position: 1, isDefault: true },
    });
    for (let i = 0; i < 2; i++) {
      const cust = await prisma.customer.create({ data: { tenantId: T_ADMIN, name: `C${i}`, mobile: `+9199${i}0000000` } });
      await prisma.lead.create({ data: { tenantId: T_ADMIN, customerId: cust.id, stageId, source: "WEBSITE", assignedTo: agentId } });
    }

    const res = await GET(getReq());
    const json = await res.json() as Record<string, unknown>;
    const agent = (json.agents as Array<Record<string, unknown>>).find((a) => a.id === agentId);
    expect(agent?.openLeadCount).toBe(2);
  });

  it("tenant isolation: does not return agents from other tenants", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    // Seed agent for T_OTHER — should NOT appear in T_ADMIN response
    await seedAgent(T_OTHER);

    const res = await GET(getReq());
    const json = await res.json() as Record<string, unknown>;
    const agents = json.agents as Array<Record<string, unknown>>;
    // All returned agents must belong to T_ADMIN
    expect(agents.every((a) => !a.email?.toString().includes(T_OTHER))).toBe(true);
  });
});
