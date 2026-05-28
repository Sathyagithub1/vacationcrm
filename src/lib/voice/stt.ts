/**
 * src/lib/voice/stt.ts
 *
 * Speech-to-Text (STT) provider abstraction (Phase 6d).
 *
 * Transcribes an audio file URL to text for a given tenant.
 *
 * v1 status — STUBBED:
 *   Returns deterministic mock data so the pipeline tests can run without
 *   live API credentials.  See TODO_BLOCKERS.md § 6D-B2 for the real-provider
 *   integration path (Google Speech-to-Text, Deepgram, Sarvam AI).
 *
 * Interface contract (stable):
 *   transcribeAudio(tenantId, audioUrl, language?)
 *     → { text: string; language: string; confidence: number }
 *
 * Tenant config fields read:
 *   tenant.sttProvider  — e.g. "google", "deepgram", "sarvam"
 *   tenant.sttApiKey    — provider API key
 */

import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** BCP-47 language tag detected or passed in */
  language: string;
  /** Provider confidence in [0, 1] */
  confidence: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = "en-IN";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transcribe an audio file to text.
 *
 * @param tenantId    Tenant whose STT credentials to use.
 * @param audioUrl    URL of the audio file to transcribe.
 * @param language    BCP-47 hint (optional).  Defaults to "en-IN".
 * @returns           Transcription text, detected language, and confidence.
 * @throws            If the tenant is not found.
 */
export async function transcribeAudio(
  tenantId: string,
  audioUrl: string,
  language?: string,
): Promise<TranscriptionResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      sttProvider: true,
      sttApiKey: true,
    },
  });

  if (!tenant) {
    throw new Error(`[STT] Tenant not found: ${tenantId}`);
  }

  // Decrypt sttApiKey at read time if it was encrypted at rest.
  // NEVER log the decrypted key.
  const _sttApiKey = tenant.sttApiKey ? decryptIfEncrypted(tenant.sttApiKey) : null;

  const resolvedLanguage = language ?? DEFAULT_LANGUAGE;

  // TODO 6D-B2: replace stub with real provider dispatch once sttProvider/sttApiKey
  // are configured.  Routing table:
  //   "google"   → Google Cloud Speech-to-Text v2 API
  //   "deepgram" → Deepgram Nova-2 async transcription
  //   "sarvam"   → Sarvam AI (best for Indian languages)
  //   default    → throw unsupported provider error
  //
  // For v1, return a mock so the voice agent dialogue loop can run in tests.
  console.warn(
    `[STT] provider="${tenant.sttProvider ?? "none"}" is not yet wired for ` +
      `tenantId=${tenantId}. Returning stub transcription. See TODO_BLOCKERS.md § 6D-B2`,
  );

  return {
    text: `[stub transcription of ${audioUrl}]`,
    language: resolvedLanguage,
    confidence: 0.0,
  };
}
