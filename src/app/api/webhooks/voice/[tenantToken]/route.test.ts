/**
 * src/app/api/webhooks/voice/[tenantToken]/route.test.ts
 *
 * Tests for the inbound voice webhook handler (Phase 6d).
 *
 * Tests cover:
 *   - 401 for unknown tenantToken
 *   - 403 when voiceAgentEnabled is false
 *   - 400 for missing required fields (callSid/From/To)
 *   - 200 returns greeting + nextWebhookUrl on valid inbound call
 *   - VoiceCall record created in DB
 *   - Signature verification failure → 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockTenantFindUnique,
  mockVoiceCallCreate,
  mockVoiceCallUpdate,
  mockDepartmentFindMany,
  mockGetTelephonyProvider,
  mockEnsureConversationForCall,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockVoiceCallCreate: vi.fn(),
  mockVoiceCallUpdate: vi.fn(),
  mockDepartmentFindMany: vi.fn(),
  mockGetTelephonyProvider: vi.fn(),
  mockEnsureConversationForCall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    voiceCall: {
      create: mockVoiceCallCreate,
      update: mockVoiceCallUpdate,
    },
    department: { findMany: mockDepartmentFindMany },
  },
}));

vi.mock("@/lib/telephony", () => ({
  getTelephonyProvider: mockGetTelephonyProvider,
}));

vi.mock("@/modules/voice/conversation-sync", () => ({
  ensureConversationForCall: mockEnsureConversationForCall,
}));

import { POST } from "./route";

// ── Constants ─────────────────────────────────────────────────────────────────
const INTAKE_TOKEN = "intake-token-voice-1";
const TENANT_ID = "tenant-voice-wh-1";
const routeContext = { params: Promise.resolve({ tenantToken: INTAKE_TOKEN }) };

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenantMock(opts: {
  voiceAgentEnabled?: boolean;
  telephonyProvider?: string | null;
  telephonyApiSecret?: string | null;
  voiceAgentLanguages?: string[];
} = {}) {
  mockTenantFindUnique.mockResolvedValue({
    id: TENANT_ID,
    voiceAgentEnabled: opts.voiceAgentEnabled ?? true,
    telephonyProvider: opts.telephonyProvider ?? null,
    telephonyApiSecret: opts.telephonyApiSecret ?? null,
    voiceAgentSystemPrompt: null,
    voiceAgentLanguages: opts.voiceAgentLanguages ?? ["en-IN"],
  });
}

function makeRequest(
  body: Record<string, unknown> = {},
  query = "",
): NextRequest {
  return new NextRequest(
    `http://localhost/api/webhooks/voice/${INTAKE_TOKEN}${query}`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Voice inbound webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureConversationForCall.mockResolvedValue(undefined);
    mockVoiceCallUpdate.mockResolvedValue({ id: "call-001" });
    mockDepartmentFindMany.mockResolvedValue([]);
  });

  it("returns 401 for unknown tenantToken", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    const res = await POST(makeRequest(), routeContext);
    expect(res.status).toBe(401);
  });

  it("returns 403 when voiceAgentEnabled is false", async () => {
    setTenantMock({ voiceAgentEnabled: false });
    const res = await POST(makeRequest({ callSid: "sid-1", From: "+91", To: "+91" }), routeContext);
    expect(res.status).toBe(403);
  });

  it("returns 400 when callSid is missing", async () => {
    setTenantMock();
    const res = await POST(makeRequest({ From: "+919876543210", To: "+911234567890" }), routeContext);
    expect(res.status).toBe(400);
  });

  it("returns 400 when From is missing", async () => {
    setTenantMock();
    const res = await POST(makeRequest({ callSid: "sid-1", To: "+911234567890" }), routeContext);
    expect(res.status).toBe(400);
  });

  it("creates VoiceCall and returns greeting on valid inbound call", async () => {
    setTenantMock();
    mockVoiceCallCreate.mockResolvedValue({ id: "call-new-001" });

    const req = makeRequest({
      callSid: "exo-sid-001",
      From: "+919876543210",
      To: "+911234567890",
      language: "en-IN",
    });

    const res = await POST(req, routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("CONTINUE");
    expect(typeof body.playText).toBe("string");
    expect(typeof body.nextWebhookUrl).toBe("string");
    expect(body.nextWebhookUrl).toContain("/turn");

    expect(mockVoiceCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          direction: "INBOUND",
          fromNumber: "+919876543210",
          providerCallSid: "exo-sid-001",
          status: "IN_PROGRESS",
        }),
      }),
    );
  });

  it("rejects invalid signature when telephony is configured", async () => {
    setTenantMock({ telephonyProvider: "exotel", telephonyApiSecret: "wh_secret" });
    mockGetTelephonyProvider.mockResolvedValue({
      verifyWebhookSignature: vi.fn().mockReturnValue(false),
    });

    const req = makeRequest({ callSid: "sid-001", From: "+91", To: "+91" });
    const res = await POST(req, routeContext);
    expect(res.status).toBe(401);
  });

  // ── IVR language menu (initial call, multiple languages) ────────────────────

  it("presents a language menu on initial call when >1 language configured", async () => {
    setTenantMock({ voiceAgentLanguages: ["en-IN", "hi-IN"] });
    mockVoiceCallCreate.mockResolvedValue({ id: "call-lang-1" });

    const req = makeRequest(
      { callSid: "sid-x", From: "+919876543210", To: "+911234567890" },
      "?format=json",
    );
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("GATHER");
    expect(body.stage).toBe("lang");
    expect(body.playText).toContain("Press 1 for English");
    expect(body.playText).toContain("Press 2 for Hindi");
    expect(String(body.actionUrl)).toContain("ivr=lang");
    // Still creates the VoiceCall on the initial hit.
    expect(mockVoiceCallCreate).toHaveBeenCalledTimes(1);
  });

  it("skips the language menu when a single language is configured", async () => {
    setTenantMock({ voiceAgentLanguages: ["en-IN"] });
    mockVoiceCallCreate.mockResolvedValue({ id: "call-lang-2" });

    const req = makeRequest(
      { callSid: "sid-y", From: "+919876543210", To: "+911234567890" },
      "?format=json",
    );
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.action).toBe("CONTINUE");
  });

  // ── IVR stage: language chosen → department menu ────────────────────────────

  it("presents the department menu after a language digit", async () => {
    setTenantMock({ voiceAgentLanguages: ["en-IN", "hi-IN"] });
    mockDepartmentFindMany.mockResolvedValue([
      { id: "dept-sales", name: "Sales", contactPhone: "+911111111111" },
      { id: "dept-support", name: "Support", contactPhone: null },
    ]);

    const req = makeRequest({ Digits: "2" }, "?ivr=lang&format=json");
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("GATHER");
    expect(body.stage).toBe("dept");
    expect(body.language).toBe("hi-IN"); // digit 2 → 2nd configured language
    expect(body.playText).toContain("Press 1 for Sales");
    expect(body.playText).toContain("Press 2 for Support");
    expect(String(body.actionUrl)).toContain("ivr=dept");
    // Does NOT create another VoiceCall on a DTMF hit.
    expect(mockVoiceCallCreate).not.toHaveBeenCalled();
  });

  it("falls back to default language on invalid language digit", async () => {
    setTenantMock({ voiceAgentLanguages: ["en-IN", "hi-IN"] });
    mockDepartmentFindMany.mockResolvedValue([
      { id: "dept-sales", name: "Sales", contactPhone: "+911111111111" },
    ]);

    const req = makeRequest({ Digits: "9" }, "?ivr=lang&format=json");
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.language).toBe("en-IN"); // fallback to first configured language
    expect(body.stage).toBe("dept");
  });

  it("hands to the agent when no departments exist", async () => {
    setTenantMock({ voiceAgentLanguages: ["en-IN", "hi-IN"] });
    mockDepartmentFindMany.mockResolvedValue([]);

    const req = makeRequest({ Digits: "1" }, "?ivr=lang&format=json");
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.action).toBe("CONTINUE");
    expect(String(body.nextWebhookUrl)).toContain("/turn");
  });

  // ── IVR stage: department chosen → routing ──────────────────────────────────

  it("transfers to the department's contact phone on a valid dept digit", async () => {
    setTenantMock();
    mockDepartmentFindMany.mockResolvedValue([
      { id: "dept-sales", name: "Sales", contactPhone: "+911111111111" },
      { id: "dept-support", name: "Support", contactPhone: null },
    ]);

    const req = makeRequest({ Digits: "1" }, "?ivr=dept&lang=en-IN&format=json");
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.action).toBe("TRANSFER");
    expect(body.departmentId).toBe("dept-sales");
    expect(body.transferTo).toBe("+911111111111");
  });

  it("hands a phoneless department to the agent turn", async () => {
    setTenantMock();
    mockDepartmentFindMany.mockResolvedValue([
      { id: "dept-sales", name: "Sales", contactPhone: "+911111111111" },
      { id: "dept-support", name: "Support", contactPhone: null },
    ]);

    const req = makeRequest({ Digits: "2" }, "?ivr=dept&lang=en-IN&format=json");
    const res = await POST(req, routeContext);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.action).toBe("CONTINUE");
    expect(body.departmentId).toBe("dept-support");
    expect(String(body.nextWebhookUrl)).toContain("/turn");
  });

  it("reprompts once on an invalid department digit, then hands to agent", async () => {
    setTenantMock();
    mockDepartmentFindMany.mockResolvedValue([
      { id: "dept-sales", name: "Sales", contactPhone: "+911111111111" },
    ]);

    // First invalid attempt → reprompt with retry=1
    const first = await POST(
      makeRequest({ Digits: "9" }, "?ivr=dept&lang=en-IN&format=json"),
      routeContext,
    );
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody.action).toBe("GATHER");
    expect(String(firstBody.actionUrl)).toContain("retry=1");

    // Second invalid attempt (retry already spent) → hand to agent
    const second = await POST(
      makeRequest({ Digits: "9" }, "?ivr=dept&lang=en-IN&retry=1&format=json"),
      routeContext,
    );
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.action).toBe("CONTINUE");
  });

  it("fails closed on bad signature even on a DTMF (ivr) hit", async () => {
    setTenantMock({ telephonyProvider: "exotel", telephonyApiSecret: "wh_secret" });
    mockGetTelephonyProvider.mockResolvedValue({
      verifyWebhookSignature: vi.fn().mockReturnValue(false),
    });

    const req = makeRequest({ Digits: "1" }, "?ivr=dept&lang=en-IN");
    const res = await POST(req, routeContext);
    expect(res.status).toBe(401);
    // No department lookup should happen when signature verification fails.
    expect(mockDepartmentFindMany).not.toHaveBeenCalled();
  });
});
