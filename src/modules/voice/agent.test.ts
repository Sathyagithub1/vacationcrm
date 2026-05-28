/**
 * src/modules/voice/agent.test.ts
 *
 * Unit tests for the voice agent dialogue engine (Phase 6d).
 *
 * Tests cover:
 *   - CONTINUE action parsed and returned
 *   - TRANSFER action parsed from AI response
 *   - CALLBACK action triggers Callback creation
 *   - END action from explicit AI response
 *   - AI provider failure → apology message + END (fail-soft)
 *   - Unknown action defaults to CONTINUE
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockVoiceCallFindUnique,
  mockVoiceCallSegmentCreate,
  mockTenantFindUnique,
  mockLeadFindUnique,
  mockCallbackCreate,
  mockGetAIProvider,
  mockGetCustomerContext,
  mockMirrorSegmentToMessage,
} = vi.hoisted(() => ({
  mockVoiceCallFindUnique: vi.fn(),
  mockVoiceCallSegmentCreate: vi.fn(),
  mockTenantFindUnique: vi.fn(),
  mockLeadFindUnique: vi.fn(),
  mockCallbackCreate: vi.fn(),
  mockGetAIProvider: vi.fn(),
  mockGetCustomerContext: vi.fn(),
  mockMirrorSegmentToMessage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    voiceCall: { findUnique: mockVoiceCallFindUnique },
    voiceCallSegment: { create: mockVoiceCallSegmentCreate },
    lead: { findUnique: mockLeadFindUnique },
    callback: { create: mockCallbackCreate },
  },
}));

vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: mockGetAIProvider,
}));

vi.mock("@/modules/memory/customer-memory", () => ({
  getCustomerContext: mockGetCustomerContext,
}));

vi.mock("./conversation-sync", () => ({
  mirrorSegmentToMessage: mockMirrorSegmentToMessage,
}));

import { runVoiceAgentTurn } from "./agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-voice-1";
const CALL_ID = "call-001";
const CUSTOMER_ID = "cust-001";

function setVoiceCall(opts: {
  customerId?: string | null;
  leadId?: string | null;
  language?: string | null;
} = {}) {
  mockVoiceCallFindUnique.mockResolvedValue({
    id: CALL_ID,
    tenantId: TENANT_ID,
    customerId: opts.customerId ?? CUSTOMER_ID,
    leadId: opts.leadId ?? null,
    language: opts.language ?? "en-IN",
    segments: [],
  });
}

function setTenant(systemPrompt?: string) {
  mockTenantFindUnique.mockResolvedValue({
    voiceAgentSystemPrompt: systemPrompt ?? null,
    name: "Holiday Delight",
  });
}

function setAIProvider(responseText: string) {
  mockGetAIProvider.mockResolvedValue({
    complete: vi.fn().mockResolvedValue(responseText),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runVoiceAgentTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: segment create always succeeds
    mockVoiceCallSegmentCreate.mockResolvedValue({ id: "seg-001" });
    // Default: customer context returns empty
    mockGetCustomerContext.mockResolvedValue({
      summary: null,
      facts: [],
      preferences: [],
      recentMessages: [],
    });
    // Default: mirror is no-op
    mockMirrorSegmentToMessage.mockResolvedValue(undefined);
  });

  it("returns CONTINUE when AI response ends with ACTION: CONTINUE", async () => {
    setVoiceCall();
    setTenant();
    setAIProvider("I can help you with that.\nACTION: CONTINUE");

    const result = await runVoiceAgentTurn(CALL_ID, "I want to book a trip to Goa");

    expect(result.nextAction).toBe("CONTINUE");
    expect(result.responseText).toContain("I can help you with that");
    expect(result.responseText).not.toContain("ACTION:");
  });

  it("returns TRANSFER when AI response ends with ACTION: TRANSFER", async () => {
    setVoiceCall();
    setTenant();
    setAIProvider("Let me connect you to a specialist.\nACTION: TRANSFER");

    const result = await runVoiceAgentTurn(CALL_ID, "I need to speak to someone");

    expect(result.nextAction).toBe("TRANSFER");
    expect(result.responseText).toContain("Let me connect you");
  });

  it("returns END action when AI says ACTION: END", async () => {
    setVoiceCall();
    setTenant();
    setAIProvider("Your booking is confirmed. Thank you!\nACTION: END");

    const result = await runVoiceAgentTurn(CALL_ID, "Yes, please confirm");

    expect(result.nextAction).toBe("END");
    expect(result.responseText).not.toContain("ACTION:");
  });

  it("CALLBACK action triggers Callback creation", async () => {
    setVoiceCall({ leadId: "lead-001" });
    setTenant();
    setAIProvider("I'll have an agent call you back.\nACTION: CALLBACK");
    mockLeadFindUnique.mockResolvedValue({
      departmentId: "dept-001",
      tenantId: TENANT_ID,
    });
    mockCallbackCreate.mockResolvedValue({ id: "callback-new-1" });

    const result = await runVoiceAgentTurn(CALL_ID, "Please call me back later");

    expect(result.nextAction).toBe("CALLBACK");
    expect(mockCallbackCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          leadId: "lead-001",
          status: "SCHEDULED",
        }),
      }),
    );
  });

  it("returns apology + END on AI provider error (fail-soft)", async () => {
    setVoiceCall();
    setTenant();
    mockGetAIProvider.mockRejectedValue(new Error("AI provider unavailable"));

    const result = await runVoiceAgentTurn(CALL_ID, "Can you help me?");

    expect(result.nextAction).toBe("END");
    expect(result.responseText).toContain("sorry");
  });

  it("throws when VoiceCall is not found", async () => {
    mockVoiceCallFindUnique.mockResolvedValue(null);

    await expect(
      runVoiceAgentTurn("nonexistent-call", "Hello"),
    ).rejects.toThrow("VoiceCall not found");
  });
});
