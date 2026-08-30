/**
 * src/lib/voice/audio-storage.ts
 *
 * Pluggable storage abstraction for synthesised TTS audio (Phase 6f hardening).
 *
 * Motivation:
 *   The original TTS path wrote MP3s directly to `public/tts/<uuid>.mp3` with no
 *   TTL / cleanup. On a single host this grows unbounded; across multiple
 *   replicas the file only exists on the pod that generated it, so a peer replica
 *   (or the telephony provider hitting a different pod) 404s. This module keeps
 *   the same default behaviour (local disk, same URL shape) but makes storage
 *   swappable and adds a TTL cleanup sweep.
 *
 * Backends:
 *   - "local" (default) — writes to public/tts/<uuid>.<ext>, returns /tts/<file>.
 *   - "s3"              — env-gated via TTS_STORAGE=s3. To avoid adding a new
 *                         npm dependency, the AWS SDK is imported lazily and ONLY
 *                         if it already exists in the runtime. If it is not
 *                         installed, we log a clear warning ONCE and fall back to
 *                         local disk so the IVR flow never breaks.
 *
 * Env config (all optional; only read when TTS_STORAGE=s3):
 *   TTS_STORAGE         — "s3" to enable S3, anything else / unset → local disk.
 *   TTS_S3_BUCKET       — target bucket name (required for s3).
 *   TTS_S3_PREFIX       — optional key prefix (default "tts/").
 *   TTS_S3_REGION       — AWS region (falls back to AWS_REGION).
 *   TTS_S3_PUBLIC_BASE  — optional public base URL for returned links
 *                         (e.g. https://cdn.example.com). If unset, an
 *                         https://<bucket>.s3.<region>.amazonaws.com/<key> URL
 *                         is returned.
 *
 * Interface contract (stable):
 *   saveTtsAudio(buffer, ext?)      → Promise<string>  (URL/path to the audio)
 *   cleanupTtsAudio(maxAgeMs?)      → Promise<{ deleted: number }>
 *
 * SECURITY: this module never logs API keys, secrets, or credentials.
 */

import { writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default TTL for cleanup: 24 hours. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Absolute path to the local public/tts directory. */
function ttsDir(): string {
  return join(process.cwd(), "public", "tts");
}

// Warn only once per process if S3 is requested but unusable.
let s3FallbackWarned = false;

// ── Local disk backend ────────────────────────────────────────────────────────

async function saveToLocalDisk(buffer: Buffer, ext: string): Promise<string> {
  const fileName = `${randomUUID()}.${ext}`;
  const dir = ttsDir();

  // Ensure directory exists (no-op if already present).
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), buffer);

  return `/tts/${fileName}`;
}

// ── S3 backend (dependency-free, lazy, best-effort) ───────────────────────────

/**
 * Attempt to load the AWS S3 client WITHOUT declaring it as a dependency.
 * Uses a runtime require so bundlers/type-checkers don't force the package to
 * exist. Returns null if the SDK isn't installed.
 */
async function loadS3Client(): Promise<unknown | null> {
  try {
    // Indirect require so static analysis doesn't treat this as a hard dep.
    const req = eval("require") as NodeRequire;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = req("@aws-sdk/client-s3");
    return mod ?? null;
  } catch {
    return null;
  }
}

async function saveToS3(buffer: Buffer, ext: string): Promise<string | null> {
  const bucket = process.env.TTS_S3_BUCKET;
  if (!bucket) {
    if (!s3FallbackWarned) {
      console.warn(
        "[audio-storage] TTS_STORAGE=s3 but TTS_S3_BUCKET is not set. " +
          "Falling back to local disk.",
      );
      s3FallbackWarned = true;
    }
    return null;
  }

  const sdk = (await loadS3Client()) as
    | {
        S3Client: new (cfg: unknown) => {
          send: (cmd: unknown) => Promise<unknown>;
        };
        PutObjectCommand: new (input: unknown) => unknown;
      }
    | null;

  if (!sdk || !sdk.S3Client || !sdk.PutObjectCommand) {
    if (!s3FallbackWarned) {
      console.warn(
        "[audio-storage] TTS_STORAGE=s3 requested but @aws-sdk/client-s3 is not " +
          "installed. Add it to enable S3 storage. Falling back to local disk.",
      );
      s3FallbackWarned = true;
    }
    return null;
  }

  const region = process.env.TTS_S3_REGION ?? process.env.AWS_REGION;
  const prefix = (process.env.TTS_S3_PREFIX ?? "tts/").replace(/^\/+/, "");
  const key = `${prefix}${randomUUID()}.${ext}`;
  const contentType = ext === "mp3" ? "audio/mpeg" : "application/octet-stream";

  const client = new sdk.S3Client(region ? { region } : {});
  await client.send(
    new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const publicBase = process.env.TTS_S3_PUBLIC_BASE;
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, "")}/${key}`;
  }
  if (region) {
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a synthesised audio buffer and return a URL/path to play it.
 *
 * Default (local): writes public/tts/<uuid>.<ext> and returns `/tts/<file>`,
 * identical to the pre-hardening behaviour.
 *
 * When TTS_STORAGE=s3 and @aws-sdk/client-s3 is available, uploads to S3 and
 * returns the object URL. If S3 is requested but unavailable/misconfigured, it
 * warns once and falls back to local disk so the flow never breaks.
 *
 * @param buffer  Raw audio bytes.
 * @param ext     File extension without the dot (default "mp3").
 * @returns       URL or relative path to the stored audio.
 */
export async function saveTtsAudio(buffer: Buffer, ext = "mp3"): Promise<string> {
  const safeExt = (ext || "mp3").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3";

  if ((process.env.TTS_STORAGE ?? "").toLowerCase() === "s3") {
    const s3Url = await saveToS3(buffer, safeExt);
    if (s3Url) {
      return s3Url;
    }
    // else: fall through to local disk (warning already emitted).
  }

  return saveToLocalDisk(buffer, safeExt);
}

/**
 * Delete local TTS audio files older than `maxAgeMs` (TTL cleanup sweep).
 *
 * Intended to be invoked periodically (see integration notes at the bottom of
 * this file) to bound disk growth. Safe to call when the directory is missing
 * (returns { deleted: 0 }). Only operates on the local public/tts directory;
 * S3 lifecycle should be configured via a bucket lifecycle rule instead.
 *
 * @param maxAgeMs  Max file age in milliseconds (default 24h).
 * @returns         Count of files deleted.
 */
export async function cleanupTtsAudio(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Promise<{ deleted: number }> {
  const dir = ttsDir();
  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory missing / unreadable → nothing to clean.
    return { deleted: 0 };
  }

  for (const name of entries) {
    const filePath = join(dir, name);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        continue;
      }
      if (info.mtimeMs < cutoff) {
        await unlink(filePath);
        deleted += 1;
      }
    } catch {
      // File may have been removed concurrently, or is not statable — skip it.
      continue;
    }
  }

  return { deleted };
}

/*
 * INTEGRATION NOTES — cleanup must be scheduled by a caller.
 *
 * cleanupTtsAudio() is NOT self-scheduling. Wire it into an existing periodic
 * job so the public/tts directory stays bounded on local-disk deployments, e.g.:
 *
 *   import { cleanupTtsAudio } from "@/lib/voice/audio-storage";
 *   const { deleted } = await cleanupTtsAudio(); // default 24h TTL
 *   console.log(`[tts-cleanup] removed ${deleted} stale audio files`);
 *
 * A daily cron / scheduled task is sufficient. For S3-backed storage, prefer a
 * bucket lifecycle expiration rule instead of this sweep.
 */
