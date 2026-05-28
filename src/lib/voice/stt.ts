/**
 * src/lib/voice/stt.ts
 *
 * Speech-to-Text (STT) provider abstraction (Phase 6f).
 *
 * Transcribes an audio file URL to text for a given tenant.
 *
 * Supported provider:
 *   "GOOGLE" / "google" — Google Cloud Speech-to-Text v1 REST API
 *
 * Authentication:
 *   API key passed as `?key=<decrypted-sttApiKey>` query parameter.
 *   Tenant field: `sttApiKey` (encrypted at rest, decrypted via `decryptIfEncrypted`).
 *
 * Audio source:
 *   - If `audioUrl` starts with "gs://" → `audio.uri` (GCS reference, no download)
 *   - Otherwise → fetch audio bytes, base64-encode, use `audio.content`
 *
 * Fail-soft:
 *   Any provider error is caught, logged with tenantId, and returns
 *   { text: "", language: <resolved>, confidence: 0 } so the calling voice
 *   agent can degrade gracefully rather than crashing the IVR flow.
 *
 * Unsupported providers:
 *   Log a warn and return mock transcription (same as stub).
 *   This maintains backward compatibility for tenants with no provider set.
 *
 * Interface contract (stable):
 *   transcribeAudio(tenantId, audioUrl, language?)
 *     → { text: string; language: string; confidence: number }
 *
 * Tenant config fields read:
 *   tenant.sttProvider  — "GOOGLE" (case-insensitive)
 *   tenant.sttApiKey    — encrypted Google Cloud API key
 */

import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import { toGoogleLangCode } from "./lang-codes";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TranscriptionResult {
  /** Transcribed text */
  text: string;
  /** BCP-47 language tag detected or passed in */
  language: string;
  /** Provider confidence in [0, 1] */
  confidence: number;
}

// ── Google Cloud Speech-to-Text v1 response shape ─────────────────────────────

interface GoogleSttAlternative {
  transcript: string;
  confidence?: number;
}

interface GoogleSttResult {
  alternatives: GoogleSttAlternative[];
  languageCode?: string;
}

interface GoogleSttResponse {
  results?: GoogleSttResult[];
  error?: { code: number; message: string; status: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = "en-IN";
const GOOGLE_STT_URL = "https://speech.googleapis.com/v1/speech:recognize";

// ── Google provider implementation ────────────────────────────────────────────

async function transcribeWithGoogle(
  apiKey: string,
  audioUrl: string,
  languageCode: string,
): Promise<TranscriptionResult> {
  // Build audio payload: GCS URI or base64 content
  let audioPayload: { uri: string } | { content: string };

  if (audioUrl.startsWith("gs://")) {
    audioPayload = { uri: audioUrl };
  } else {
    // Fetch audio bytes and base64-encode for inline content
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(
        `[STT/Google] Failed to fetch audio from ${audioUrl}: HTTP ${audioRes.status}`,
      );
    }
    const audioBuffer = await audioRes.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");
    audioPayload = { content: base64Audio };
  }

  const requestBody = {
    config: {
      encoding: "MP3",
      languageCode,
      model: "default",
    },
    audio: audioPayload,
  };

  const url = `${GOOGLE_STT_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = (await res.json()) as GoogleSttResponse;

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[STT/Google] API error: ${errMsg}`);
  }

  const firstResult = data.results?.[0];
  const firstAlt = firstResult?.alternatives?.[0];

  return {
    text: firstAlt?.transcript ?? "",
    language: firstResult?.languageCode ?? languageCode,
    confidence: firstAlt?.confidence ?? 0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transcribe an audio file to text.
 *
 * @param tenantId    Tenant whose STT credentials to use.
 * @param audioUrl    URL of the audio file to transcribe.
 *                    Use "gs://<bucket>/<path>" for GCS references (no download).
 *                    Any other URL will be fetched and base64-encoded.
 * @param language    BCP-47 hint (optional). Defaults to "en-IN".
 *                    2-letter ISO codes (e.g. "hi", "ta") are auto-expanded to
 *                    their Indian BCP-47 variant via toGoogleLangCode().
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

  const resolvedLanguage = toGoogleLangCode(language ?? DEFAULT_LANGUAGE);

  const providerLower = (tenant.sttProvider ?? "").toLowerCase();

  // ── Google Cloud Speech-to-Text ──────────────────────────────────────────
  if (providerLower === "google") {
    if (!tenant.sttApiKey) {
      console.warn(
        `[STT] sttProvider=GOOGLE but sttApiKey is not set for tenantId=${tenantId}. ` +
          "Returning stub transcription.",
      );
      return stubResult(audioUrl, resolvedLanguage);
    }

    const apiKey = decryptIfEncrypted(tenant.sttApiKey);

    try {
      return await transcribeWithGoogle(apiKey, audioUrl, resolvedLanguage);
    } catch (err) {
      console.warn(
        `[STT] Google transcription failed for tenantId=${tenantId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return { text: "", language: resolvedLanguage, confidence: 0 };
    }
  }

  // ── Unsupported / unconfigured provider ──────────────────────────────────
  console.warn(
    `[STT] provider="${tenant.sttProvider ?? "none"}" is not yet wired for ` +
      `tenantId=${tenantId}. Returning stub transcription. ` +
      "Set sttProvider=GOOGLE and sttApiKey to enable real transcription.",
  );

  return stubResult(audioUrl, resolvedLanguage);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubResult(audioUrl: string, language: string): TranscriptionResult {
  return {
    text: `[stub transcription of ${audioUrl}]`,
    language,
    confidence: 0.0,
  };
}
