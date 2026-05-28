/**
 * src/lib/voice/tts.test.ts
 *
 * Unit tests for the TTS provider (Phase 6f).
 *
 * Tests cover:
 *   - Returns stub audioUrl when no ttsProvider is configured
 *   - Language is included in the stub URL (pass-through)
 *   - Throws when tenant is not found
 *   - Google provider: calls correct API URL with key
 *   - Google provider: writes MP3 file and returns /tts/<uuid>.mp3 path
 *   - Google provider: fail-soft on API error (returns stub URL)
 *   - Google provider: fail-soft when ttsApiKey missing
 *   - Encrypted ttsApiKey is decrypted before use
 *   - toGoogleLangCode applied to input language
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Mock decryptIfEncrypted — strip "v1:encrypted:" prefix as sentinel
vi.mock("@/lib/crypto/credential-encryption", () => ({
  decryptIfEncrypted: (v: string) =>
    v.startsWith("v1:") ? v.replace("v1:encrypted:", "") : v,
}));

// Mock fs/promises to avoid actual disk writes in tests
const { mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

// Mock randomUUID to produce deterministic file names
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
  };
});

import { synthesizeSpeech } from "./tts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenant(
  ttsProvider: string | null = null,
  ttsApiKey: string | null = null,
) {
  mockTenantFindUnique.mockResolvedValue({ ttsProvider, ttsApiKey });
}

function mockGoogleTtsSuccess(audioContentBase64 = Buffer.from("fake-mp3").toString("base64")) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(
      JSON.stringify({ audioContent: audioContentBase64 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

// ── Stub behaviour (backward compat) ─────────────────────────────────────────

describe("synthesizeSpeech — stub fallback", () => {
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

  it("still returns a stub URL even when ttsProvider is set to unknown", async () => {
    setTenant("elevenlabs", "some-key");
    const result = await synthesizeSpeech("tenant-1", "Booking confirmed", "en-IN");
    expect(result.audioUrl).toContain("en-IN");
  });
});

// ── Google Cloud TTS ──────────────────────────────────────────────────────────

describe("synthesizeSpeech — Google provider", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("calls Google TTS API with API key in query param", async () => {
    setTenant("GOOGLE", "my-google-api-key");
    const mockFetch = mockGoogleTtsSuccess();

    await synthesizeSpeech("tenant-1", "Hello", "en-IN");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("texttospeech.googleapis.com");
    expect(url).toContain("key=my-google-api-key");
  });

  it("writes MP3 to public/tts/<uuid>.mp3 and returns /tts/<uuid>.mp3", async () => {
    setTenant("GOOGLE", "my-google-api-key");
    mockGoogleTtsSuccess();

    const result = await synthesizeSpeech("tenant-1", "Booking confirmed", "en-IN");

    expect(result.audioUrl).toBe("/tts/test-uuid-1234.mp3");
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [filePath] = mockWriteFile.mock.calls[0] as [string];
    expect(filePath).toContain("test-uuid-1234.mp3");
    expect(filePath).toContain("public");
  });

  it("sends correct request body with languageCode and NEUTRAL gender", async () => {
    setTenant("GOOGLE", "my-google-api-key");
    const mockFetch = mockGoogleTtsSuccess();

    await synthesizeSpeech("tenant-1", "How can I help you today?", "hi-IN");

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.input.text).toBe("How can I help you today?");
    expect(body.voice.languageCode).toBe("hi-IN");
    expect(body.voice.ssmlGender).toBe("NEUTRAL");
    expect(body.audioConfig.audioEncoding).toBe("MP3");
  });

  it("fail-soft: returns stub URL on Google API error", async () => {
    setTenant("GOOGLE", "my-google-api-key");
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 400, message: "Text too long" } }),
        { status: 400 },
      ),
    );

    const result = await synthesizeSpeech("tenant-1", "very long text...", "en-IN");

    expect(result.audioUrl).toContain("stub");
  });

  it("fail-soft: returns stub URL when ttsApiKey is null (provider=GOOGLE, no key)", async () => {
    setTenant("GOOGLE", null);
    const result = await synthesizeSpeech("tenant-1", "Hello", "en-IN");
    expect(result.audioUrl).toContain("stub");
  });

  it("decrypts ttsApiKey before calling Google API", async () => {
    setTenant("GOOGLE", "v1:encrypted:real-tts-key");
    const mockFetch = mockGoogleTtsSuccess();

    await synthesizeSpeech("tenant-1", "Hello", "en-IN");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("key=real-tts-key");
  });

  it("expands 2-letter lang code to xx-IN before calling Google API", async () => {
    setTenant("GOOGLE", "my-google-api-key");
    const mockFetch = mockGoogleTtsSuccess();

    await synthesizeSpeech("tenant-1", "నమస్కారం", "te"); // Telugu 2-letter

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
    expect(body.voice.languageCode).toBe("te-IN");
  });
});
