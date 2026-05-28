/**
 * src/app/api/webhooks/google-forms/[tenantToken]/route.test.ts
 *
 * Integration tests for T34 — Google Forms intake webhook.
 * Uses real DB; one tenant per test for isolation.
 *
 * HMAC is computed with the same algorithm as the Apps Script template:
 *   sha256=<hex(HMAC-SHA256(body, googleFormsKey))>
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

// ── Mock AI provider ─────────────────────────────────────────────────────────
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue(null),
  classifySpam: vi.fn().mockResolvedValue({ confidence: 0, isSpam: false }),
  extractCanonicalFields: vi.fn().mockResolvedValue({}),
}));

// ── Constants ─────────────────────────────────────────────────────────────────
const T_BAD_TOKEN   = "t-gform-badtok";
const T_NO_KEY      = "t-gform-nokey";
const T_HAPPY       = "t-gform-happy";
const T_BAD_SIG     = "t-gform-badsig";

const ALL_TENANTS = [T_BAD_TOKEN, T_NO_KEY, T_HAPPY, T_BAD_SIG];
// Each test tenant gets its own unique signing key to satisfy the UNIQUE constraint.
const SIGNING_KEYS: Record<string, string> = {
  [T_HAPPY]:   "test-gforms-key-happy-abc123",
  [T_BAD_SIG]: "test-gforms-key-badsig-xyz789",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSig(body: string, key: string): string {
  return "sha256=" + createHmac("sha256", key).update(body, "utf8").digest("hex");
}

async function seedTenant(id: string, opts: { googleFormsKey?: string } = {}): Promise<string> {
  const result = await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id, ...(opts.googleFormsKey ? { googleFormsKey: opts.googleFormsKey } : {}) },
    select: { intakeToken: true },
  });
  return result.intakeToken;
}

async function seedTenantWithKey(id: string, key: string): Promise<string> {
  const result = await prisma.tenant.upsert({
    where: { id },
    update: { googleFormsKey: key },
    create: { id, name: id, slug: id, googleFormsKey: key },
    select: { intakeToken: true },
  });
  return result.intakeToken;
}

async function seedStage(tenantId: string) {
  await prisma.pipelineStage.upsert({
    where: { id: `stage-gform-${tenantId}` },
    update: {},
    create: {
      id: `stage-gform-${tenantId}`,
      tenantId,
      name: "New",
      slug: "new",
      position: 1,
      isDefault: true,
    },
  });
}

async function seedAdmin(tenantId: string) {
  await prisma.user.upsert({
    where: { id: `admin-gform-${tenantId}` },
    update: {},
    create: {
      id: `admin-gform-${tenantId}`,
      tenantId,
      email: `admin-gform-${tenantId}@test.com`,
      passwordHash: "x",
      name: `Admin ${tenantId}`,
      role: "COMPANY_ADMIN",
      isActive: true,
      languages: [],
      tags: [],
    },
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
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
}

function makeRequest(token: string, body: object, headers?: Record<string, string>): NextRequest {
  const bodyStr = JSON.stringify(body);
  return new NextRequest(`http://localhost/api/webhooks/google-forms/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyStr,
  });
}

function makeContext(token: string) {
  return { params: Promise.resolve({ tenantToken: token }) };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  for (const t of ALL_TENANTS) {
    await prisma.tenant.upsert({
      where: { id: t },
      update: {},
      create: { id: t, name: t, slug: t },
    });
    await clearTenant(t);
  }
});

afterAll(async () => {
  for (const t of ALL_TENANTS) await clearTenant(t);
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/google-forms/[tenantToken] (T34)", () => {

  // ── 1. Bad token → 401 ───────────────────────────────────────────────────
  it("returns 401 when tenantToken is not recognised", async () => {
    const res = await POST(
      makeRequest("not-a-real-token", { name: "Test" }),
      makeContext("not-a-real-token"),
    );

    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/invalid/i);
  });

  // ── 2. Tenant exists but googleFormsKey null → 412 ───────────────────────
  it("returns 412 when tenant exists but googleFormsKey is not configured", async () => {
    const intakeToken = await seedTenant(T_NO_KEY); // no key set

    const res = await POST(
      makeRequest(intakeToken, { name: "Test" }),
      makeContext(intakeToken),
    );

    expect(res.status).toBe(412);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/key not configured/i);
  });

  // ── 3. Valid token + valid HMAC → 200 with leadId ────────────────────────
  it("happy path: valid token + correct HMAC → 200 with leadId", async () => {
    const signingKey = SIGNING_KEYS[T_HAPPY];
    const intakeToken = await seedTenantWithKey(T_HAPPY, signingKey);
    await seedStage(T_HAPPY);
    await seedAdmin(T_HAPPY);

    const body = {
      name: "Google Forms User",
      email: "gform@test.com",
      phone: "+919988776601",
    };
    const bodyStr = JSON.stringify(body);
    const sig = computeSig(bodyStr, signingKey);

    const req = new NextRequest(`http://localhost/api/webhooks/google-forms/${intakeToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": sig },
      body: bodyStr,
    });

    const res = await POST(req, makeContext(intakeToken));

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(typeof json.leadId).toBe("string");

    // Verify IntakeWebhookLog was created with correct metadata
    const log = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: T_HAPPY },
      orderBy: { receivedAt: "desc" },
    });
    expect(log?.source).toBe("GOOGLE_FORMS");
    expect(log?.signatureValid).toBe(true);
  });

  // ── 4. Valid token + bad HMAC → 401 ─────────────────────────────────────
  it("returns 401 when HMAC signature is incorrect", async () => {
    const signingKey = SIGNING_KEYS[T_BAD_SIG];
    const intakeToken = await seedTenantWithKey(T_BAD_SIG, signingKey);

    const body = { name: "Bad Sig Test", phone: "+919988776602" };
    const wrongSig = computeSig(JSON.stringify(body), "completely-wrong-key");

    const req = new NextRequest(`http://localhost/api/webhooks/google-forms/${intakeToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": wrongSig },
      body: JSON.stringify(body),
    });

    const res = await POST(req, makeContext(intakeToken));

    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/signature/i);
  });
});
