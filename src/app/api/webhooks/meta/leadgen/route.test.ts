/**
 * src/app/api/webhooks/meta/leadgen/route.test.ts
 *
 * Integration tests for T33 — Meta Lead Ads webhook.
 * Uses real DB; stubs META_VERIFY_TOKEN + META_APP_SECRET env vars.
 * Mocks @/lib/meta-graph to avoid real Graph API calls.
 *
 * HMAC computation helper in this file matches the production implementation
 * exactly: sha256-HMAC of the raw JSON body string using META_APP_SECRET.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";
import type { MetaLead } from "@/lib/meta-graph";

// ── Mock @/lib/meta-graph ────────────────────────────────────────────────────
// Using vi.hoisted so the mock fn reference is available before module loading.
const mockGetMetaLead = vi.hoisted(() =>
  vi.fn<(id: string, token: string) => Promise<MetaLead>>(),
);
vi.mock("@/lib/meta-graph", () => ({
  getMetaLead: mockGetMetaLead,
}));

// ── Mock AI provider so spam + normalize stages don't call external services ─
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue(null),
  classifySpam: vi.fn().mockResolvedValue({ confidence: 0, isSpam: false }),
  extractCanonicalFields: vi.fn().mockResolvedValue({}),
}));

// ── Env stubs ─────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = "test-verify-token";
const APP_SECRET   = "test-app-secret";

beforeAll(() => {
  vi.stubEnv("META_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await clearAll();
  await prisma.$disconnect();
});

// ── Constants ─────────────────────────────────────────────────────────────────
const T_META = "t-meta-leadgen";
const PAGE_ID = "page-12345";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSig(body: string): string {
  return "sha256=" + createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex");
}

function makeLeadgenBody(pageId: string, leadgenId: string): object {
  return {
    object: "page",
    entry: [
      {
        id: pageId,
        time: 1234567890,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              page_id: pageId,
              form_id: "form-abc-001",
              created_time: 1234567890,
            },
          },
        ],
      },
    ],
  };
}

function makePostRequest(body: object, sig: string): NextRequest {
  const bodyStr = JSON.stringify(body);
  return new NextRequest("http://localhost/api/webhooks/meta/leadgen", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": sig,
    },
    body: bodyStr,
  });
}

async function seedTenantAndChannel(
  tenantId: string,
  pageId: string,
): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: tenantId, slug: tenantId },
  });

  await prisma.pipelineStage.upsert({
    where: { id: `stage-meta-${tenantId}` },
    update: {},
    create: {
      id: `stage-meta-${tenantId}`,
      tenantId,
      name: "New",
      slug: "new",
      position: 1,
      isDefault: true,
    },
  });

  // Seed a COMPANY_ADMIN for the assignment fallback
  await prisma.user.upsert({
    where: { id: `admin-meta-${tenantId}` },
    update: {},
    create: {
      id: `admin-meta-${tenantId}`,
      tenantId,
      email: `admin-meta-${tenantId}@test.com`,
      passwordHash: "x",
      name: `Admin Meta ${tenantId}`,
      role: "COMPANY_ADMIN",
      isActive: true,
      languages: [],
      tags: [],
    },
  });

  // ChannelConfig with page_id in config and an access_token
  await prisma.channelConfig.upsert({
    where: { id: `cc-meta-${tenantId}` },
    update: {},
    create: {
      id: `cc-meta-${tenantId}`,
      tenantId,
      channel: "FACEBOOK",
      isActive: true,
      credentials: JSON.stringify({ pageAccessToken: "page-access-token-test" }),
      config: { page_id: pageId, access_token: "page-access-token-test" },
    },
  });
}

async function clearAll() {
  await prisma.message.deleteMany({ where: { tenantId: T_META } });
  await prisma.conversation.deleteMany({ where: { tenantId: T_META } });
  await prisma.leadActivity.deleteMany({ where: { tenantId: T_META } });
  await prisma.lead.deleteMany({ where: { tenantId: T_META } });
  await prisma.customer.deleteMany({ where: { tenantId: T_META } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId: T_META } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId: T_META } });
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId: T_META } });
  await prisma.user.deleteMany({ where: { tenantId: T_META } });
  await prisma.channelConfig.deleteMany({ where: { tenantId: T_META } });
}

beforeEach(async () => {
  mockGetMetaLead.mockReset();
  await clearAll();
  await prisma.tenant.upsert({
    where: { id: T_META },
    update: {},
    create: { id: T_META, name: T_META, slug: T_META },
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/webhooks/meta/leadgen (T33 — hub verification)", () => {

  // ── 1. Correct verify token → 200 with challenge body ────────────────────
  it("returns 200 with challenge text when verify_token matches", async () => {
    const req = new NextRequest(
      `http://localhost/api/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
    );

    const res = await GET(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("abc123");
  });

  // ── 2. Wrong verify token → 403 ──────────────────────────────────────────
  it("returns 403 when verify_token does not match", async () => {
    const req = new NextRequest(
      "http://localhost/api/webhooks/meta/leadgen?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=abc123",
    );

    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/webhooks/meta/leadgen (T33 — lead delivery)", () => {

  // ── 3. Invalid signature → 401 ────────────────────────────────────────────
  it("returns 401 when X-Hub-Signature-256 does not match", async () => {
    const body = makeLeadgenBody(PAGE_ID, "lead-001");
    const req = makePostRequest(body, "sha256=invalidsignaturehere");

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toMatch(/signature/i);
  });

  // ── 4. Valid signature but unknown page_id → 200 processed:0 ─────────────
  it("returns 200 processed:0 when page_id has no matching ChannelConfig", async () => {
    const body = makeLeadgenBody("unknown-page-999", "lead-002");
    const bodyStr = JSON.stringify(body);
    const sig = computeSig(bodyStr);

    const req = new NextRequest("http://localhost/api/webhooks/meta/leadgen", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body: bodyStr,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(0);
  });

  // ── 5. Valid + known page → fetches lead, creates log + lead ─────────────
  it("valid signature + known page_id → getMetaLead called, IntakeWebhookLog created, lead created", async () => {
    await seedTenantAndChannel(T_META, PAGE_ID);

    const leadgenId = "lead-003-valid";
    const body = makeLeadgenBody(PAGE_ID, leadgenId);
    const bodyStr = JSON.stringify(body);
    const sig = computeSig(bodyStr);

    // Mock getMetaLead to return a valid lead
    mockGetMetaLead.mockResolvedValueOnce({
      id: leadgenId,
      created_time: "2026-05-27T00:00:00Z",
      form_id: "form-abc-001",
      field_data: [
        { name: "full_name", values: ["Meta Lead User"] },
        { name: "email", values: ["metalead@test.com"] },
        { name: "phone_number", values: ["+919988776655"] },
      ],
    });

    const req = new NextRequest("http://localhost/api/webhooks/meta/leadgen", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sig },
      body: bodyStr,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(1);

    // getMetaLead must have been called with leadgenId and the access token
    expect(mockGetMetaLead).toHaveBeenCalledOnce();
    expect(mockGetMetaLead).toHaveBeenCalledWith(leadgenId, "page-access-token-test");

    // IntakeWebhookLog must exist
    const log = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: T_META },
      orderBy: { receivedAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.source).toBe("META_LEAD_AD");
    expect(log?.signatureValid).toBe(true);

    // At least one Lead must have been created
    const leads = await prisma.lead.findMany({ where: { tenantId: T_META } });
    expect(leads.length).toBeGreaterThanOrEqual(1);
    const lead = leads[0];
    expect(lead.source).toBe("META_LEAD_AD");
  });
});
