/**
 * src/app/api/integrations/test/route.ts
 *
 * Phase 6k — "Test connection" for tenant integrations.
 *
 * POST /api/integrations/test
 *   Body: { provider: "razorpay" | "smtp" | "telephony" | "stt" | "tts" }
 *
 * Validates the tenant's CURRENTLY-STORED credentials against the real provider
 * with a safe, read-only / no-side-effect call:
 *   - razorpay  → GET /v1/orders?count=1        (HTTP Basic key_id:key_secret)
 *   - smtp      → nodemailer transporter.verify() (connect + AUTH, sends nothing)
 *   - telephony → Exotel account GET / FreJun authed GET
 *   - stt/tts   → minimal Google Cloud REST call to validate the API key
 *
 * Never returns or logs secret values. Credentials are decrypted in-memory only.
 *
 * Auth: requires "settings:integrations" permission.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import nodemailer from "nodemailer";

type TestResult = { ok: boolean; message: string };

// Fetch with a hard timeout so a hung provider can't stall the request.
async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  ms = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Razorpay ────────────────────────────────────────────────────────────────
async function testRazorpay(tenantId: string): Promise<TestResult> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { razorpayKeyId: true, razorpayKeySecret: true },
  });
  if (!t?.razorpayKeyId || !t?.razorpayKeySecret) {
    return { ok: false, message: "Razorpay isn't configured yet — save a Key ID and Key Secret first." };
  }
  const keyId = t.razorpayKeyId;
  const keySecret = decryptIfEncrypted(t.razorpayKeySecret);
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const res = await fetchWithTimeout("https://api.razorpay.com/v1/orders?count=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.ok) {
      const mode = keyId.startsWith("rzp_live") ? "live" : "test";
      return { ok: true, message: `Connected to Razorpay (${mode} mode). Credentials are valid.` };
    }
    if (res.status === 401) {
      return { ok: false, message: "Razorpay rejected the credentials (401). Check the Key ID and Key Secret." };
    }
    return { ok: false, message: `Razorpay returned HTTP ${res.status}. Try again shortly.` };
  } catch {
    return { ok: false, message: "Couldn't reach Razorpay (network/timeout)." };
  }
}

// ── SMTP ──────────────────────────────────────────────────────────────────────
async function testSmtp(tenantId: string): Promise<TestResult> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { emailTemplateConfig: true },
  });
  const cfg = (t?.emailTemplateConfig ?? {}) as Record<string, string>;
  if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
    return { ok: false, message: "SMTP isn't fully configured — host, username, and password are required." };
  }
  const port = parseInt(cfg.smtpPort || "587", 10);
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    secure: port === 465,
    auth: { user: cfg.smtpUser, pass: decryptIfEncrypted(cfg.smtpPass) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transporter.verify();
    return { ok: true, message: `Connected to ${cfg.smtpHost}:${port} and authenticated successfully.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `SMTP check failed: ${msg}` };
  }
}

// ── Telephony ──────────────────────────────────────────────────────────────────
async function testTelephony(tenantId: string): Promise<TestResult> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { telephonyProvider: true, telephonyApiKey: true },
  });
  if (!t?.telephonyProvider || !t?.telephonyApiKey) {
    return { ok: false, message: "Telephony isn't configured yet — pick a provider and save credentials first." };
  }
  const apiKey = decryptIfEncrypted(t.telephonyApiKey);
  const provider = t.telephonyProvider.toLowerCase();

  if (provider === "exotel") {
    let creds: { accountSid?: string; apiKey?: string; apiToken?: string };
    try {
      creds = JSON.parse(apiKey);
    } catch {
      return { ok: false, message: "Stored Exotel credentials aren't valid JSON — re-save them." };
    }
    if (!creds.accountSid || !creds.apiKey || !creds.apiToken) {
      return { ok: false, message: "Exotel credentials are incomplete (need Account SID, API Key, API Token)." };
    }
    const auth = Buffer.from(`${creds.apiKey}:${creds.apiToken}`).toString("base64");
    try {
      const res = await fetchWithTimeout(
        `https://api.exotel.com/v1/Accounts/${encodeURIComponent(creds.accountSid)}.json`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (res.ok) return { ok: true, message: "Connected to Exotel and authenticated." };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Exotel rejected the credentials (HTTP ${res.status}).` };
      }
      return { ok: false, message: `Exotel returned HTTP ${res.status}.` };
    } catch {
      return { ok: false, message: "Couldn't reach Exotel (network/timeout)." };
    }
  }

  if (provider === "frejun") {
    let creds: { apiToken?: string };
    try {
      creds = JSON.parse(apiKey);
    } catch {
      return { ok: false, message: "Stored FreJun credentials aren't valid JSON — re-save them." };
    }
    if (!creds.apiToken) {
      return { ok: false, message: "FreJun API token is missing — re-save the credentials." };
    }
    try {
      const res = await fetchWithTimeout("https://api.frejun.com/v1/calls?page_size=1", {
        headers: { Authorization: `Bearer ${creds.apiToken}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `FreJun rejected the API token (HTTP ${res.status}).` };
      }
      // 200 (listed) or 404 (endpoint shape differs) both mean auth was accepted.
      if (res.ok || res.status === 404) {
        return { ok: true, message: "FreJun accepted the API token." };
      }
      return { ok: false, message: `FreJun returned HTTP ${res.status}.` };
    } catch {
      return { ok: false, message: "Couldn't reach FreJun (network/timeout)." };
    }
  }

  return { ok: false, message: `Automated testing isn't available for provider "${t.telephonyProvider}".` };
}

// ── Google STT / TTS ────────────────────────────────────────────────────────────
function interpretGoogle(res: Response, name: string, errorMessage: string | null): TestResult {
  if (res.ok) return { ok: true, message: `${name}: API key is valid.` };
  const msg = errorMessage ?? `HTTP ${res.status}`;
  if (res.status === 400 && /api key not valid|API_KEY_INVALID/i.test(msg)) {
    return { ok: false, message: `${name}: the API key is invalid.` };
  }
  if (res.status === 403) {
    return { ok: false, message: `${name}: access denied — ${msg} (check the API is enabled for this key).` };
  }
  return { ok: false, message: `${name}: ${msg}` };
}

async function testGoogleVoice(tenantId: string, kind: "stt" | "tts"): Promise<TestResult> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { sttApiKey: true, ttsApiKey: true },
  });
  const rawKey = kind === "stt" ? t?.sttApiKey : t?.ttsApiKey;
  const name = kind === "stt" ? "Google Speech-to-Text" : "Google Text-to-Speech";
  if (!rawKey) {
    return { ok: false, message: `${name} isn't configured yet — save an API key first.` };
  }
  const key = decryptIfEncrypted(rawKey);
  try {
    let res: Response;
    if (kind === "tts") {
      res = await fetchWithTimeout(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: "." },
            voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
            audioConfig: { audioEncoding: "MP3" },
          }),
        },
      );
    } else {
      // 320 bytes of silence = 20ms @ 8kHz LINEAR16 — a valid, empty recognition.
      const silence = Buffer.alloc(320).toString("base64");
      res = await fetchWithTimeout(
        `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { encoding: "LINEAR16", sampleRateHertz: 8000, languageCode: "en-US" },
            audio: { content: silence },
          }),
        },
      );
    }
    let errMsg: string | null = null;
    if (!res.ok) {
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        errMsg = j.error?.message ?? null;
      } catch {
        errMsg = null;
      }
    }
    return interpretGoogle(res, name, errMsg);
  } catch {
    return { ok: false, message: `Couldn't reach ${name} (network/timeout).` };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermission("settings:integrations");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = typeof body.provider === "string" ? body.provider.toLowerCase() : "";
    const tenantId = user.tenantId;

    let result: TestResult;
    switch (provider) {
      case "razorpay":
        result = await testRazorpay(tenantId);
        break;
      case "smtp":
        result = await testSmtp(tenantId);
        break;
      case "telephony":
        result = await testTelephony(tenantId);
        break;
      case "stt":
        result = await testGoogleVoice(tenantId, "stt");
        break;
      case "tts":
        result = await testGoogleVoice(tenantId, "tts");
        break;
      default:
        return NextResponse.json({ error: "Unknown or unsupported provider" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/integrations/test error:", err);
    return NextResponse.json({ error: "Failed to run connection test" }, { status: 500 });
  }
}
