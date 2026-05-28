/**
 * src/modules/voice/conversation-sync.test.ts
 *
 * Unit tests for voice-to-conversation sync (Phase 6d).
 *
 * Tests cover:
 *   - ensureConversationForCall creates Customer + Conversation when neither exists
 *   - ensureConversationForCall is idempotent (conversationId already set → no-op)
 *   - mirrorSegmentToMessage creates a TEXT Message from a CUSTOMER segment
 *   - mirrorSegmentToMessage uses AUDIO type when audioUrl is present
 *   - mirrorSegmentToMessage skips when conversationId is null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockVoiceCallFindUnique,
  mockVoiceCallUpdate,
  mockVoiceCallSegmentFindUnique,
  mockCustomerFindFirst,
  mockCustomerCreate,
  mockConversationFindFirst,
  mockConversationCreate,
  mockMessageCreate,
} = vi.hoisted(() => ({
  mockVoiceCallFindUnique: vi.fn(),
  mockVoiceCallUpdate: vi.fn(),
  mockVoiceCallSegmentFindUnique: vi.fn(),
  mockCustomerFindFirst: vi.fn(),
  mockCustomerCreate: vi.fn(),
  mockConversationFindFirst: vi.fn(),
  mockConversationCreate: vi.fn(),
  mockMessageCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceCall: {
      findUnique: mockVoiceCallFindUnique,
      update: mockVoiceCallUpdate,
    },
    voiceCallSegment: {
      findUnique: mockVoiceCallSegmentFindUnique,
    },
    customer: {
      findFirst: mockCustomerFindFirst,
      create: mockCustomerCreate,
    },
    conversation: {
      findFirst: mockConversationFindFirst,
      create: mockConversationCreate,
    },
    message: {
      create: mockMessageCreate,
    },
  },
}));

import { ensureConversationForCall, mirrorSegmentToMessage } from "./conversation-sync";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-sync-1";
const CALL_ID = "call-sync-001";
const FROM_NUMBER = "+919876543210";

// ── ensureConversationForCall tests ───────────────────────────────────────────

describe("ensureConversationForCall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates Customer and Conversation when neither exists", async () => {
    mockVoiceCallFindUnique.mockResolvedValue({
      id: CALL_ID,
      tenantId: TENANT_ID,
      fromNumber: FROM_NUMBER,
      customerId: null,
      conversationId: null,
    });
    mockCustomerFindFirst.mockResolvedValue(null);
    mockCustomerCreate.mockResolvedValue({ id: "cust-new-1" });
    mockConversationFindFirst.mockResolvedValue(null);
    mockConversationCreate.mockResolvedValue({ id: "conv-new-1" });
    mockVoiceCallUpdate.mockResolvedValue({ id: CALL_ID });

    await ensureConversationForCall(CALL_ID);

    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mobile: FROM_NUMBER, tenantId: TENANT_ID }),
      }),
    );
    expect(mockConversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "cust-new-1" }),
      }),
    );
    expect(mockVoiceCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CALL_ID },
        data: expect.objectContaining({ conversationId: "conv-new-1" }),
      }),
    );
  });

  it("is idempotent when conversationId is already set", async () => {
    mockVoiceCallFindUnique.mockResolvedValue({
      id: CALL_ID,
      tenantId: TENANT_ID,
      fromNumber: FROM_NUMBER,
      customerId: "cust-existing",
      conversationId: "conv-existing",
    });

    await ensureConversationForCall(CALL_ID);

    // Should not attempt to create anything
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockConversationCreate).not.toHaveBeenCalled();
    expect(mockVoiceCallUpdate).not.toHaveBeenCalled();
  });

  it("throws when VoiceCall is not found", async () => {
    mockVoiceCallFindUnique.mockResolvedValue(null);
    await expect(ensureConversationForCall("ghost-call")).rejects.toThrow(
      "VoiceCall not found",
    );
  });
});

// ── mirrorSegmentToMessage tests ──────────────────────────────────────────────

describe("mirrorSegmentToMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a TEXT Message from a CUSTOMER segment without audioUrl", async () => {
    mockVoiceCallSegmentFindUnique.mockResolvedValue({
      id: "seg-001",
      speaker: "CUSTOMER",
      content: "I want to book a trip",
      audioUrl: null,
      voiceCall: { tenantId: TENANT_ID, conversationId: "conv-001" },
    });
    mockMessageCreate.mockResolvedValue({ id: "msg-001" });

    await mirrorSegmentToMessage("seg-001");

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: "CUSTOMER",
          messageType: "TEXT",
          content: "I want to book a trip",
        }),
      }),
    );
  });

  it("creates an AUDIO Message when audioUrl is present", async () => {
    mockVoiceCallSegmentFindUnique.mockResolvedValue({
      id: "seg-002",
      speaker: "BOT",
      content: "Your booking is confirmed",
      audioUrl: "https://cdn.example.com/audio/seg-002.mp3",
      voiceCall: { tenantId: TENANT_ID, conversationId: "conv-001" },
    });
    mockMessageCreate.mockResolvedValue({ id: "msg-002" });

    await mirrorSegmentToMessage("seg-002");

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageType: "AUDIO",
          fileUrl: "https://cdn.example.com/audio/seg-002.mp3",
        }),
      }),
    );
  });

  it("skips silently when conversationId is null", async () => {
    mockVoiceCallSegmentFindUnique.mockResolvedValue({
      id: "seg-003",
      speaker: "CUSTOMER",
      content: "Hello",
      audioUrl: null,
      voiceCall: { tenantId: TENANT_ID, conversationId: null },
    });

    await mirrorSegmentToMessage("seg-003");

    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});
