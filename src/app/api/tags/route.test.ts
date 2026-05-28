/**
 * src/app/api/tags/route.test.ts
 *
 * T42 tests — Tags CRUD.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, POST } from "./route";

const T_ADMIN = "t-tag-admin";
const T_OTHER = "t-tag-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function clearTenant(t: string) {
  await prisma.tag.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("T42 Tags CRUD", () => {

  it("POST creates tag → 201", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await POST(postReq({ name: "VIP", scope: "LEAD", color: "#ff0000" }));
    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    const tag = json.tag as Record<string, unknown>;
    expect(tag.name).toBe("VIP");
    expect(tag.scope).toBe("LEAD");
    expect(tag.color).toBe("#ff0000");
  });

  it("POST rejects duplicate (name + scope) within same tenant → 409", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    await POST(postReq({ name: "Hot", scope: "LEAD" }));
    const res2 = await POST(postReq({ name: "Hot", scope: "LEAD" }));
    expect(res2.status).toBe(409);
  });

  it("POST allows same name with different scope (not a duplicate)", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    await POST(postReq({ name: "Loyal", scope: "CUSTOMER" }));
    const res2 = await POST(postReq({ name: "Loyal", scope: "LEAD" }));
    expect(res2.status).toBe(201);
  });

  it("GET with scope filter returns only matching tags", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    await POST(postReq({ name: "TagA", scope: "CUSTOMER" }));
    await POST(postReq({ name: "TagB", scope: "LEAD" }));
    await POST(postReq({ name: "TagC", scope: "BOTH" }));

    const res = await GET(new NextRequest("http://localhost/api/tags?scope=LEAD"));
    const json = await res.json() as Record<string, unknown>;
    const tags = json.tags as Array<Record<string, unknown>>;
    expect(tags.every((t) => t.scope === "LEAD")).toBe(true);
    expect(tags.length).toBe(1);
  });

  it("POST invalid scope → 400", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await POST(postReq({ name: "BadScope", scope: "INVALID" }));
    expect(res.status).toBe(400);
  });

  it("tenant isolation: GET returns only own tenant tags", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    await POST(postReq({ name: "Admin Tag", scope: "BOTH" }));

    setSession(T_OTHER, "COMPANY_ADMIN");
    const res = await GET(new NextRequest("http://localhost/api/tags"));
    const json = await res.json() as Record<string, unknown>;
    const tags = json.tags as Array<Record<string, unknown>>;
    expect(tags.every((t) => t.name !== "Admin Tag")).toBe(true);
  });
});
