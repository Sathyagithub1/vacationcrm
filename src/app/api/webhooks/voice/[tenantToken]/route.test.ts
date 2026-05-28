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
  mockGetTelephonyProvider,
  mockEnsureConversationForCall,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockVoiceCallCreate: vi.fn(),
  mockVoiceCallUpdate: vi.fn(),
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
} = {}) {
  mockTenantFindUnique.mockResolvedValue({
    id: TENANT_ID,
    voiceAgentEnabled: opts.voiceAgentEnabled ?? true,
    telephonyProvider: opts.telephonyProvider ?? null,
    telephonyApiSecret: opts.telephonyApiSecret ?? null,
    voiceAgentSystemPrompt: null,
    voiceAgentLanguages: ["en-IN"],
  });
}

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(
    `http://localhost/api/webhooks/voice/${INTAKE_TOKEN}`,
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
          status: "RINGING",
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
});
