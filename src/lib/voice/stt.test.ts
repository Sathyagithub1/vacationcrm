/**
 * src/lib/voice/stt.test.ts
 *
 * Unit tests for the STT provider abstraction (Phase 6d).
 *
 * Tests cover:
 *   - Returns stub transcription when no sttProvider is configured
 *   - Language pass-through (provided language is returned)
 *   - Default language used when none is provided
 *   - Throws when tenant is not found
 *   - Confidence is 0 in stub mode (documents v1 behaviour)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoist mock ────────────────────────────────────────────────────────────────
const { mockTenantFindUnique } = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mockTenantFindUnique,
    },
  },
}));

import { transcribeAudio } from "./stt";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenant(sttProvider: string | null = null, sttApiKey: string | null = null) {
  mockTenantFindUnique.mockResolvedValue({ sttProvider, sttApiKey });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("transcribeAudio", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stub text when sttProvider is null", async () => {
    setTenant(null, null);
    const result = await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3");
    expect(result.text).toContain("stub");
    expect(result.confidence).toBe(0);
  });

  it("passes through provided language", async () => {
    setTenant(null, null);
    const result = await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3", "hi-IN");
    expect(result.language).toBe("hi-IN");
  });

  it("uses en-IN as default language when none provided", async () => {
    setTenant(null, null);
    const result = await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3");
    expect(result.language).toBe("en-IN");
  });

  it("throws when tenant is not found", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    await expect(
      transcribeAudio("ghost-tenant", "https://cdn.example.com/call.mp3"),
    ).rejects.toThrow("Tenant not found");
  });

  it("returns stub with confidence 0 even when sttProvider is configured (deferred)", async () => {
    setTenant("google", "google-api-key");
    const result = await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3", "en-US");
    // v1: stub always returns confidence=0 regardless of configured provider
    expect(result.confidence).toBe(0);
    expect(result.language).toBe("en-US");
  });
});
