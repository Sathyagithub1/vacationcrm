/**
 * src/app/api/webhooks/voice/[tenantToken]/turn/route.test.ts
 *
 * Tests for the IVR per-turn webhook handler (Phase 6d).
 *
 * Tests cover:
 *   - 401 for unknown tenantToken
 *   - 400 for missing voiceCallId / utterance
 *   - 403 when voiceCall belongs to different tenant
 *   - CONTINUE response contains nextWebhookUrl
 *   - END response marks call completed
 *   - TRANSFER response includes transferTo
 *   - AI error → 200 with fail-soft message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockTenantFindUnique,
  mockVoiceCallFindUnique,
  mockVoiceCallUpdate,
  mockRunVoiceAgentTurn,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockVoiceCallFindUnique: vi.fn(),
  mockVoiceCallUpdate: vi.fn(),
  mockRunVoiceAgentTurn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    voiceCall: {
      findUnique: mockVoiceCallFindUnique,
      update: mockVoiceCallUpdate,
    },
  },
}));

vi.mock("@/modules/voice/agent", () => ({
  runVoiceAgentTurn: mockRunVoiceAgentTurn,
}));

import { POST } from "./route";

// ── Constants ─────────────────────────────────────────────────────────────────
const INTAKE_TOKEN = "intake-token-voice-turn";
const TENANT_ID = "tenant-voice-turn-1";
const CALL_ID = "call-turn-001";
const routeContext = { params: Promise.resolve({ tenantToken: INTAKE_TOKEN }) };

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenant(voiceAgentEnabled = true) {
  mockTenantFindUnique.mockResolvedValue({
    id: TENANT_ID,
    telephonyPhoneNumber: "+911800000000",
    voiceAgentEnabled,
  });
}

function setVoiceCall(tenantId = TENANT_ID, status = "IN_PROGRESS") {
  mockVoiceCallFindUnique.mockResolvedValue({ tenantId, status });
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/webhooks/voice/${INTAKE_TOKEN}/turn`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Voice IVR turn webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceCallUpdate.mockResolvedValue({ id: CALL_ID });
  });

  it("returns 401 for unknown tenantToken", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "Hello" }), routeContext);
    expect(res.status).toBe(401);
  });

  it("returns 400 when voiceCallId is missing", async () => {
    setTenant();
    const res = await POST(makeRequest({ utterance: "Hello" }), routeContext);
    expect(res.status).toBe(400);
  });

  it("returns 400 when utterance is empty", async () => {
    setTenant();
    setVoiceCall();
    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "  " }), routeContext);
    expect(res.status).toBe(400);
  });

  it("returns 403 when VoiceCall belongs to different tenant", async () => {
    setTenant();
    setVoiceCall("other-tenant");
    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "Hello" }), routeContext);
    expect(res.status).toBe(403);
  });

  it("returns CONTINUE response with nextWebhookUrl", async () => {
    setTenant();
    setVoiceCall();
    mockRunVoiceAgentTurn.mockResolvedValue({
      responseText: "What destination are you interested in?",
      nextAction: "CONTINUE",
    });

    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "I want to book a trip" }), routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("CONTINUE");
    expect(body.playText).toContain("destination");
    expect(typeof body.nextWebhookUrl).toBe("string");
  });

  it("returns END response on ACTION: END", async () => {
    setTenant();
    setVoiceCall();
    mockRunVoiceAgentTurn.mockResolvedValue({
      responseText: "Your booking is confirmed. Goodbye!",
      nextAction: "END",
    });

    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "Yes please" }), routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(body.action).toBe("END");
  });

  it("returns TRANSFER response with transferTo number", async () => {
    setTenant();
    setVoiceCall();
    mockRunVoiceAgentTurn.mockResolvedValue({
      responseText: "Transferring you now.",
      nextAction: "TRANSFER",
    });

    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "Transfer me" }), routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(body.action).toBe("TRANSFER");
    expect(body.transferTo).toBeTruthy();
  });

  it("returns 200 fail-soft message when runVoiceAgentTurn throws", async () => {
    setTenant();
    setVoiceCall();
    mockRunVoiceAgentTurn.mockRejectedValue(new Error("AI unavailable"));

    const res = await POST(makeRequest({ voiceCallId: CALL_ID, utterance: "Hello" }), routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.action).toBe("END");
  });
});
