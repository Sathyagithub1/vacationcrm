/**
 * src/lib/voice/tts.ts
 *
 * Text-to-Speech (TTS) provider abstraction (Phase 6f).
 *
 * Synthesises speech from text for a given tenant and returns a playable URL.
 *
 * Supported provider:
 *   "GOOGLE" / "google" — Google Cloud Text-to-Speech v1 REST API
 *
 * Authentication:
 *   API key passed as `?key=<decrypted-ttsApiKey>` query parameter.
 *   Tenant field: `ttsApiKey` (encrypted at rest, decrypted via `decryptIfEncrypted`).
 *
 * Audio delivery:
 *   Google returns audio as base64-encoded MP3 in `audioContent`.
 *   The bytes are written to `public/tts/<uuid>.mp3` and the relative URL
 *   `/tts/<uuid>.mp3` is returned.  The telephony provider fetches this URL
 *   from the same server to play the audio.
 *
 *   NOTE: This approach assumes the app is served from a single host.  In
 *   distributed/serverless deployments, replace with an S3/GCS pre-signed URL.
 *
 * Fail-soft:
 *   Any provider error is caught, logged with tenantId, and returns a stub
 *   URL so the IVR flow does not crash.
 *
 * Interface contract (stable):
 *   synthesizeSpeech(tenantId, text, language)
 *     → { audioUrl: string }
 *
 * Tenant config fields read:
 *   tenant.ttsProvider — "GOOGLE" (case-insensitive)
 *   tenant.ttsApiKey   — encrypted Google Cloud API key
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import { toGoogleLangCode } from "./lang-codes";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SynthesisResult {
  /** URL to the synthesised audio file */
  audioUrl: string;
}

// ── Google Cloud TTS response shape ───────────────────────────────────────────

interface GoogleTtsResponse {
  audioContent?: string; // base64-encoded MP3
  error?: { code: number; message: string; status: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

// ── Google TTS implementation ─────────────────────────────────────────────────

async function synthesizeWithGoogle(
  apiKey: string,
  text: string,
  languageCode: string,
): Promise<SynthesisResult> {
  const requestBody = {
    input: { text },
    voice: { languageCode, ssmlGender: "NEUTRAL" },
    audioConfig: { audioEncoding: "MP3" },
  };

  const url = `${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = (await res.json()) as GoogleTtsResponse;

  if (!res.ok || data.error) {
    const errMsg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[TTS/Google] API error: ${errMsg}`);
  }

  if (!data.audioContent) {
    throw new Error("[TTS/Google] Response missing audioContent");
  }

  // Decode base64 MP3 and write to public/tts/<uuid>.mp3
  const audioBuffer = Buffer.from(data.audioContent, "base64");
  const fileName = `${randomUUID()}.mp3`;
  const ttsDir = join(process.cwd(), "public", "tts");

  // Ensure directory exists (no-op if already present)
  await mkdir(ttsDir, { recursive: true });
  await writeFile(join(ttsDir, fileName), audioBuffer);

  return { audioUrl: `/tts/${fileName}` };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Synthesise speech from text using the tenant's configured TTS provider.
 *
 * @param tenantId  Tenant whose TTS credentials to use.
 * @param text      Text to speak (UTF-8, max ~5000 chars per call).
 * @param language  BCP-47 language tag or 2-letter ISO code.
 *                  2-letter codes are expanded to xx-IN via toGoogleLangCode().
 * @returns         URL to the generated audio file (relative path for same-host serving).
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

  const resolvedLanguage = toGoogleLangCode(language);
  const providerLower = (tenant.ttsProvider ?? "").toLowerCase();

  // ── Google Cloud Text-to-Speech ──────────────────────────────────────────
  if (providerLower === "google") {
    if (!tenant.ttsApiKey) {
      console.warn(
        `[TTS] ttsProvider=GOOGLE but ttsApiKey is not set for tenantId=${tenantId}. ` +
          "Returning stub audioUrl.",
      );
      return stubResult(resolvedLanguage, text);
    }

    const apiKey = decryptIfEncrypted(tenant.ttsApiKey);

    try {
      return await synthesizeWithGoogle(apiKey, text, resolvedLanguage);
    } catch (err) {
      console.warn(
        `[TTS] Google synthesis failed for tenantId=${tenantId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return stubResult(resolvedLanguage, text);
    }
  }

  // ── Unsupported / unconfigured provider ──────────────────────────────────
  console.warn(
    `[TTS] provider="${tenant.ttsProvider ?? "none"}" is not yet wired for ` +
      `tenantId=${tenantId}. Returning stub audioUrl. ` +
      "Set ttsProvider=GOOGLE and ttsApiKey to enable real TTS.",
  );

  return stubResult(resolvedLanguage, text);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stubResult(language: string, text: string): SynthesisResult {
  const slug = encodeURIComponent(text.slice(0, 30));
  return {
    audioUrl: `https://tts-stub.example.com/${language}/${slug}.mp3`,
  };
}
