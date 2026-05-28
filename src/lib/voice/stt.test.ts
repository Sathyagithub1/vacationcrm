/**
 * src/lib/voice/stt.test.ts
 *
 * Unit tests for the STT provider (Phase 6f).
 *
 * Tests cover:
 *   - Returns stub transcription when no sttProvider is configured
 *   - Language pass-through (provided language is returned)
 *   - Default language used when none is provided
 *   - Throws when tenant is not found
 *   - Google provider: calls correct API URL with key
 *   - Google provider: handles GCS URI path (no fetch for audio bytes)
 *   - Google provider: base64-encodes non-GCS audio via fetch
 *   - Google provider: returns transcript + confidence from response
 *   - Google provider: fail-soft on API error (returns empty text, confidence=0)
 *   - Google provider: fail-soft when sttApiKey missing
 *   - toGoogleLangCode: 2-letter codes expanded to xx-IN
 *   - toGoogleLangCode: already-qualified tags passed through
 *   - Encrypted key is decrypted before use
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toGoogleLangCode } from "./lang-codes";

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

// Mock decryptIfEncrypted — pass through for non-encrypted; return decoded for v1: prefix
vi.mock("@/lib/crypto/credential-encryption", () => ({
  decryptIfEncrypted: (v: string) =>
    v.startsWith("v1:") ? v.replace("v1:encrypted:", "") : v,
}));

import { transcribeAudio } from "./stt";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenant(
  sttProvider: string | null = null,
  sttApiKey: string | null = null,
) {
  mockTenantFindUnique.mockResolvedValue({ sttProvider, sttApiKey });
}

function mockGoogleSttSuccess(transcript: string, confidence = 0.95) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        results: [
          {
            alternatives: [{ transcript, confidence }],
            languageCode: "en-IN",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

// ── Stub behaviour (backward compat) ─────────────────────────────────────────

describe("transcribeAudio — stub fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stub text when sttProvider is null", async () => {
    setTenant(null, null);
    const result = await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3");
    expect(result.text).toContain("stub");
    expect(result.confidence).toBe(0);
  });

  it("passes through provided language (BCP-47 tag)", async () => {
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
});

// ── Google Cloud STT ──────────────────────────────────────────────────────────

describe("transcribeAudio — Google provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Google Speech API with API key in query param", async () => {
    setTenant("GOOGLE", "test-google-api-key");
    const mockFetch = mockGoogleSttSuccess("Hello, I want to book a trip");

    await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3", "en-IN");

    // First call is the Google STT API (second would be audio fetch, but GCS is used for gs://)
    // For non-GCS: first call fetches audio, second calls Google
    const calls = mockFetch.mock.calls;
    // The audio fetch comes first; find the Google API call
    const googleCall = calls.find(([url]) =>
      (url as string).includes("speech.googleapis.com"),
    );
    expect(googleCall).toBeDefined();
    expect(googleCall![0] as string).toContain("key=test-google-api-key");
  });

  it("uses audio.uri for GCS URLs (no audio fetch)", async () => {
    setTenant("GOOGLE", "test-google-api-key");
    const mockFetch = mockGoogleSttSuccess("Booking for Bali");

    await transcribeAudio("tenant-1", "gs://my-bucket/call-recordings/call-001.mp3", "en-IN");

    // Only ONE fetch call: the Google API. No prefetch for audio bytes.
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.audio.uri).toBe("gs://my-bucket/call-recordings/call-001.mp3");
    expect(body.audio.content).toBeUndefined();
  });

  it("fetches and base64-encodes non-GCS audio", async () => {
    setTenant("GOOGLE", "test-google-api-key");

    // Mock: first fetch = audio bytes; second fetch = Google STT
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(Buffer.from("fake-mp3-bytes"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ alternatives: [{ transcript: "test", confidence: 0.9 }] }],
          }),
          { status: 200 },
        ),
      );

    await transcribeAudio("tenant-1", "https://cdn.example.com/call.mp3", "en-IN");

    // Second call should be the Google API with base64 content
    const googleCallBody = JSON.parse(
      vi.mocked(global.fetch).mock.calls[1][1]?.body as string,
    );
    expect(googleCallBody.audio.content).toBeDefined();
    expect(googleCallBody.audio.uri).toBeUndefined();
  });

  it("returns transcript and confidence from Google response", async () => {
    setTenant("GOOGLE", "test-google-api-key");
    mockGoogleSttSuccess("I want to book a holiday package", 0.97);

    const result = await transcribeAudio("tenant-1", "gs://bucket/call.mp3", "en-IN");

    expect(result.text).toBe("I want to book a holiday package");
    expect(result.confidence).toBe(0.97);
    expect(result.language).toBe("en-IN");
  });

  it("fail-soft: returns empty text on Google API error", async () => {
    setTenant("GOOGLE", "test-google-api-key");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 403, message: "API key invalid" } }),
        { status: 403 },
      ),
    );

    const result = await transcribeAudio("tenant-1", "gs://bucket/call.mp3", "en-IN");

    expect(result.text).toBe("");
    expect(result.confidence).toBe(0);
    expect(result.language).toBe("en-IN");
  });

  it("fail-soft: returns stub when sttApiKey is null even if provider=GOOGLE", async () => {
    setTenant("GOOGLE", null);
    const result = await transcribeAudio("tenant-1", "https://example.com/call.mp3");
    expect(result.text).toContain("stub");
    expect(result.confidence).toBe(0);
  });

  it("decrypts sttApiKey before calling Google API", async () => {
    // Simulate an encrypted key: our mock decryptIfEncrypted strips "v1:encrypted:"
    setTenant("GOOGLE", "v1:encrypted:real-api-key");
    const mockFetch = mockGoogleSttSuccess("Booking confirmed");

    await transcribeAudio("tenant-1", "gs://bucket/call.mp3", "en-IN");

    // The decrypted key "real-api-key" should appear in the URL
    const googleCall = mockFetch.mock.calls.find(([url]) =>
      (url as string).includes("speech.googleapis.com"),
    );
    expect(googleCall![0] as string).toContain("key=real-api-key");
  });
});

// ── toGoogleLangCode ──────────────────────────────────────────────────────────

describe("toGoogleLangCode", () => {
  it("maps 'hi' to 'hi-IN'", () => {
    expect(toGoogleLangCode("hi")).toBe("hi-IN");
  });

  it("maps 'ta' to 'ta-IN'", () => {
    expect(toGoogleLangCode("ta")).toBe("ta-IN");
  });

  it("maps 'en' to 'en-IN'", () => {
    expect(toGoogleLangCode("en")).toBe("en-IN");
  });

  it("passes through already-qualified tags unchanged", () => {
    expect(toGoogleLangCode("en-US")).toBe("en-US");
    expect(toGoogleLangCode("hi-IN")).toBe("hi-IN");
  });

  it("falls back to 'en-IN' for unknown 2-letter codes", () => {
    expect(toGoogleLangCode("xx")).toBe("en-IN");
  });

  it("handles empty string → 'en-IN'", () => {
    expect(toGoogleLangCode("")).toBe("en-IN");
  });
});
