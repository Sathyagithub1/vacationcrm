/**
 * src/lib/voice/tts.test.ts
 *
 * Unit tests for the TTS provider abstraction (Phase 6d).
 *
 * Tests cover:
 *   - Returns stub audioUrl when no ttsProvider is configured
 *   - Language is included in the stub URL (pass-through)
 *   - Throws when tenant is not found
 *   - Returns audioUrl even when ttsProvider is configured (deferred)
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

import { synthesizeSpeech } from "./tts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenant(ttsProvider: string | null = null, ttsApiKey: string | null = null) {
  mockTenantFindUnique.mockResolvedValue({ ttsProvider, ttsApiKey });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("synthesizeSpeech", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an audioUrl when ttsProvider is null", async () => {
    setTenant(null, null);
    const result = await synthesizeSpeech("tenant-1", "Hello, how can I help?", "en-IN");
    expect(result.audioUrl).toBeTruthy();
    expect(typeof result.audioUrl).toBe("string");
  });

  it("includes the language tag in the stub URL", async () => {
    setTenant(null, null);
    const result = await synthesizeSpeech("tenant-1", "नमस्ते", "hi-IN");
    expect(result.audioUrl).toContain("hi-IN");
  });

  it("throws when tenant is not found", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    await expect(
      synthesizeSpeech("ghost-tenant", "Hello", "en-IN"),
    ).rejects.toThrow("Tenant not found");
  });

  it("still returns a stub URL even when ttsProvider is configured (deferred)", async () => {
    setTenant("google", "goog-api-key");
    const result = await synthesizeSpeech("tenant-1", "Booking confirmed", "en-IN");
    // v1: stub always returns a URL regardless of configured provider
    expect(result.audioUrl).toContain("en-IN");
  });
});
