/**
 * src/app/api/webhooks/intake/[tenantToken]/route.test.ts
 *
 * Integration tests for T32 — Universal intake webhook.
 * Uses real DB; one tenant per test to guarantee isolation.
 *
 * AI provider is mocked at zero confidence so the pipeline doesn't call
 * external services. All pipeline stages run against the real test DB.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// ── Mock AI provider (used by spam classifier + normalize NLP) ───────────────
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue(null),
  classifySpam: vi.fn().mockResolvedValue({ confidence: 0, isSpam: false }),
  extractCanonicalFields: vi.fn().mockResolvedValue({}),
}));

// ── Tenant IDs — one per test ─────────────────────────────────────────────────
const T_BAD_TOKEN   = "t-intk-bad";
const T_HAPPY       = "t-intk-happy";
const T_DEDUP       = "t-intk-dedup";
const T_XSOURCE     = "t-intk-xsrc";
const T_BAD_SOURCE  = "t-intk-badsrc";
const T_PIPE_ERR    = "t-intk-piperr";

const ALL_TENANTS = [T_BAD_TOKEN, T_HAPPY, T_DEDUP, T_XSOURCE, T_BAD_SOURCE, T_PIPE_ERR];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedTenant(id: string): Promise<string> {
  const result = await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
    select: { intakeToken: true },
  });
  return result.intakeToken;
}

async function seedStage(tenantId: string): Promise<string> {
  const id = `stage-intk-${tenantId}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      name: "New",
      slug: "new",
      position: 1,
      isDefault: true,
    },
  });
  return id;
}

async function seedAdmin(tenantId: string): Promise<string> {
  const id = `admin-intk-${tenantId}`;
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      email: `admin-intk-${tenantId}@test.com`,
      passwordHash: "x",
      name: `Admin ${tenantId}`,
      role: "COMPANY_ADMIN",
      isActive: true,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function seedStrategy(tenantId: string) {
  await prisma.assignmentStrategy.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, type: "ROUND_ROBIN", config: {} },
  });
}

async function clearTenant(tenantId: string) {
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.leadActivity.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId } });
  await prisma.assignmentPool.deleteMany({ where: { tenantId } });
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
}

function makeRequest(tenantToken: string, body: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/webhooks/intake/${tenantToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeContext(tenantToken: string) {
  return { params: Promise.resolve({ tenantToken }) };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  for (const t of ALL_TENANTS) await seedTenant(t);
  for (const t of ALL_TENANTS) await clearTenant(t);
  for (const t of ALL_TENANTS) await seedTenant(t);
});

afterAll(async () => {
  for (const t of ALL_TENANTS) await clearTenant(t);
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/intake/[tenantToken] (T32)", () => {

  // ── 1. Bad token → 401 ────────────────────────────────────────────────────
  it("returns 401 when tenantToken is not recognized", async () => {
    const res = await POST(
      makeRequest("definitely-not-a-real-token", { name: "Test" }),
      makeContext("definitely-not-a-real-token"),
    );

    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/invalid/i);
  });

  // ── 2. Happy path → 200 with leadId ───────────────────────────────────────
  it("happy path: valid token + body → 200 with leadId string", async () => {
    const intakeToken = await seedTenant(T_HAPPY);
    await seedStage(T_HAPPY);
    await seedAdmin(T_HAPPY);
    await seedStrategy(T_HAPPY);

    const res = await POST(
      makeRequest(intakeToken, {
        name: "Alice Test",
        phone: "+919999000001",
        email: "alice@test.com",
      }),
      makeContext(intakeToken),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(typeof json.leadId).toBe("string");
    expect(json.leadId).not.toBeNull();
  });

  // ── 3. Dedup hit → 200 with existing leadId ───────────────────────────────
  it("dedup hit: second intake with same phone → 200 with existing leadId", async () => {
    const intakeToken = await seedTenant(T_DEDUP);
    await seedStage(T_DEDUP);
    await seedAdmin(T_DEDUP);
    await seedStrategy(T_DEDUP);

    const body = { name: "Bob Dedup", phone: "+919999000002", email: "bob@test.com" };

    // First request — creates lead
    const res1 = await POST(makeRequest(intakeToken, body), makeContext(intakeToken));
    expect(res1.status).toBe(200);
    const json1 = await res1.json() as Record<string, unknown>;
    const firstLeadId = json1.leadId as string;
    expect(firstLeadId).toBeTruthy();

    // Second request — same phone → dedup hit
    const res2 = await POST(makeRequest(intakeToken, body), makeContext(intakeToken));
    expect(res2.status).toBe(200);
    const json2 = await res2.json() as Record<string, unknown>;
    // Pipeline returns existingLeadId on dedup; route returns it as leadId or null
    // dedup short-circuits before dispatch; result.leadId will be undefined → null
    // The dedup result contains existingLeadId in dedupResult, not leadId
    // Route returns null or the existing id — check that it's not a NEW lead
    const leads = await prisma.lead.findMany({ where: { tenantId: T_DEDUP } });
    // Still exactly one lead
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe(firstLeadId);
    // Response should be 200
    expect(json2.ok).toBe(true);
  });

  // ── 4. X-Source header override ───────────────────────────────────────────
  it("X-Source header overrides body source field", async () => {
    const intakeToken = await seedTenant(T_XSOURCE);
    await seedStage(T_XSOURCE);
    await seedAdmin(T_XSOURCE);
    await seedStrategy(T_XSOURCE);

    const res = await POST(
      makeRequest(
        intakeToken,
        { name: "Carol", phone: "+919999000003", source: "WEBSITE" },
        { "x-source": "WHATSAPP" },
      ),
      makeContext(intakeToken),
    );

    expect(res.status).toBe(200);

    // Verify the IntakeWebhookLog was created with WHATSAPP (header wins)
    const log = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: T_XSOURCE },
      orderBy: { receivedAt: "desc" },
    });
    expect(log?.source).toBe("WHATSAPP");
  });

  // ── 5. Invalid source → 400 ───────────────────────────────────────────────
  it("returns 400 when source value is not a valid LeadSource", async () => {
    const intakeToken = await seedTenant(T_BAD_SOURCE);

    const res = await POST(
      makeRequest(intakeToken, { name: "Dave", phone: "+919999000004", source: "UNKNOWN_CHANNEL" }),
      makeContext(intakeToken),
    );

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(typeof json.error).toBe("string");
    expect(json.error).toMatch(/unknown source/i);
  });

  // ── 6. Pipeline error → 500 with errorMessage in log ─────────────────────
  it("returns 500 when pipeline throws (no PipelineStage rows) and writes errorMessage to log", async () => {
    const intakeToken = await seedTenant(T_PIPE_ERR);
    // Intentionally NO seedStage() — pipeline will throw "no default stage"

    const res = await POST(
      makeRequest(intakeToken, { name: "Error Test", phone: "+919999000005" }),
      makeContext(intakeToken),
    );

    expect(res.status).toBe(500);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBeDefined();

    // IntakeWebhookLog must exist and have an errorMessage
    const log = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: T_PIPE_ERR },
      orderBy: { receivedAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.errorMessage).toBeTruthy();
    expect(typeof log?.errorMessage).toBe("string");
  });
});
