/**
 * src/lib/voice/tts.ts
 *
 * Text-to-Speech (TTS) provider abstraction (Phase 6d).
 *
 * Synthesises speech from text for a given tenant and returns a playable URL.
 *
 * v1 status — STUBBED:
 *   Returns a mock audioUrl so the IVR response pipeline can work without live
 *   credentials. See TODO_BLOCKERS.md § 6D-B3 for real-provider integration.
 *
 * Interface contract (stable):
 *   synthesizeSpeech(tenantId, text, language)
 *     → { audioUrl: string }
 *
 * Tenant config fields read:
 *   tenant.ttsProvider — e.g. "google", "elevenlabs", "sarvam"
 *   tenant.ttsApiKey   — provider API key
 */

import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SynthesisResult {
  /** URL to the synthesised audio file */
  audioUrl: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Synthesise speech from text using the tenant's configured TTS provider.
 *
 * @param tenantId  Tenant whose TTS credentials to use.
 * @param text      Text to speak (UTF-8, max ~5000 chars per call).
 * @param language  BCP-47 language tag (e.g. "en-IN", "hi-IN").
 * @returns         URL to the generated audio file.
 * @throws          If the tenant is not found.
 */
export async function synthesizeSpeech(
  tenantId: string,
  text: string,
  language: string,
): Promise<SynthesisResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      ttsProvider: true,
      ttsApiKey: true,
    },
  });

  if (!tenant) {
    throw new Error(`[TTS] Tenant not found: ${tenantId}`);
  }

  // Decrypt ttsApiKey at read time if it was encrypted at rest.
  // NEVER log the decrypted key.
  const _ttsApiKey = tenant.ttsApiKey ? decryptIfEncrypted(tenant.ttsApiKey) : null;

  // TODO 6D-B3: replace stub with real provider dispatch once ttsProvider/ttsApiKey
  // are configured.  Routing table:
  //   "google"     → Google Cloud Text-to-Speech v1 WaveNet voices
  //   "elevenlabs" → ElevenLabs multilingual v2
  //   "sarvam"     → Sarvam TTS (best for Indian regional languages)
  //   default      → throw unsupported provider error
  //
  // For v1, return a deterministic mock URL so callers don't crash.
  console.warn(
    `[TTS] provider="${tenant.ttsProvider ?? "none"}" is not yet wired for ` +
      `tenantId=${tenantId}. Returning stub audioUrl. See TODO_BLOCKERS.md § 6D-B3`,
  );

  // Build a mock URL that encodes the text length and language so tests can
  // assert the pass-through without needing to decode actual audio.
  const slug = encodeURIComponent(text.slice(0, 30));
  return {
    audioUrl: `https://tts-stub.example.com/${language}/${slug}.mp3`,
  };
}
