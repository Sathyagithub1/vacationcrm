/**
 * src/app/api/spam-rules/route.test.ts
 *
 * T40 tests — SpamRule CRUD + SpamLog viewer.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, POST } from "./route";
import { GET as getLogs } from "../spam-logs/route";

const T_ADMIN = "t-spam-admin";
const T_AGENT = "t-spam-agent";
const T_OTHER = "t-spam-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function clearTenant(t: string) {
  await prisma.spamLog.deleteMany({ where: { tenantId: t } });
  await prisma.spamRule.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/spam-rules", {
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
      create: { id: `u-${t}`, tenantId: t, email: `u@${t}.com`, passwordHash: "x", name: "Admin", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
  }
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_AGENT, T_OTHER]) await clearTenant(t);
  await prisma.$disconnect();
});

describe("T40 SpamRule CRUD + SpamLog viewer", () => {

  it("POST BLACKLIST rule → 201", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await POST(postReq({ type: "BLACKLIST", identifier: "+919999999999", reason: "Spammer" }));
    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect((json.rule as Record<string, unknown>).type).toBe("BLACKLIST");
  });

  it("POST RATE_LIMIT validates threshold + windowSeconds + blockSeconds", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Missing threshold
    const bad = await POST(postReq({ type: "RATE_LIMIT", identifier: "+910000000001" }));
    expect(bad.status).toBe(400);

    // Valid
    const good = await POST(postReq({
      type: "RATE_LIMIT", identifier: "+910000000001",
      threshold: 5, windowSeconds: 60, blockSeconds: 300,
    }));
    expect(good.status).toBe(201);
  });

  it("POST PATTERN validates regex compiles", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Valid regex
    const valid = await POST(postReq({ type: "PATTERN", identifier: "^spam.*" }));
    expect(valid.status).toBe(201);

    // Invalid regex
    const invalid = await POST(postReq({ type: "PATTERN", identifier: "[unclosed" }));
    expect(invalid.status).toBe(400);
    const json = await invalid.json() as Record<string, unknown>;
    expect(json.error).toMatch(/valid regular expression/i);
  });

  it("POST AI validates aiThreshold in [0,1]", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    const bad = await POST(postReq({ type: "AI", aiThreshold: 1.5 }));
    expect(bad.status).toBe(400);

    const good = await POST(postReq({ type: "AI", aiThreshold: 0.75 }));
    expect(good.status).toBe(201);
  });

  it("AGENT role → 403 on GET", async () => {
    await prisma.user.upsert({
      where: { id: `u-${T_AGENT}` }, update: {},
      create: { id: `u-${T_AGENT}`, tenantId: T_AGENT, email: `u@${T_AGENT}.com`, passwordHash: "x", name: "A", role: "AGENT", isActive: true, languages: [], tags: [] },
    });
    setSession(T_AGENT, "AGENT");
    const res = await GET(new NextRequest("http://localhost/api/spam-rules"));
    expect(res.status).toBe(403);
  });

  it("SpamLog GET paginated with channel filter", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Seed a spam log directly
    await prisma.spamLog.create({
      data: {
        tenantId: T_ADMIN,
        channel: "WHATSAPP",
        senderIdentifier: "+919900000000",
        rawPayload: {},
        action: "BLOCKED",
      },
    });

    const res = await getLogs(new NextRequest("http://localhost/api/spam-logs?channel=WHATSAPP&limit=10"));
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect((json.logs as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("tenant isolation: SpamLog GET does not return other tenant logs", async () => {
    setSession(T_OTHER, "COMPANY_ADMIN");

    // Create log for T_ADMIN
    await prisma.spamLog.create({
      data: { tenantId: T_ADMIN, channel: "WHATSAPP", senderIdentifier: "+919911111111", rawPayload: {}, action: "BLOCKED" },
    });

    const res = await getLogs(new NextRequest("http://localhost/api/spam-logs"));
    const json = await res.json() as Record<string, unknown>;
    const logs = json.logs as Array<Record<string, unknown>>;
    // T_OTHER has no logs — all returned logs must be for T_OTHER
    expect(logs.every((l) => l.senderIdentifier !== "+919911111111")).toBe(true);
  });
});
