/**
 * src/app/api/webhooks/voice/[tenantToken]/route.ts
 *
 * Phase 6f — Inbound voice webhook handler (tenant-scoped).
 *
 * URL: POST /api/webhooks/voice/:tenantToken
 *
 * Called by the telephony provider when an inbound call arrives.
 * Tenant is identified by the intakeToken in the URL path (same pattern
 * as the intake and Razorpay webhooks).
 *
 * Flow:
 *   1. Resolve tenant by intakeToken
 *   2. Verify provider webhook signature (X-Voice-Signature header)
 *   3. Parse call metadata (CallSid/CallUUID, From, To)
 *   4. Create VoiceCall record (status: RINGING)
 *   5. Run ensureConversationForCall to link caller to a Conversation
 *   6. Return a greeting — XML for telephony providers, JSON for debug (?format=json)
 *
 * Response shape:
 *   Default: Content-Type application/xml (ExoML / PHML / TwiML per provider)
 *   ?format=json: JSON { playText, action, nextWebhookUrl, voiceCallId }
 *
 * Error handling:
 *   Unknown tenantToken      → 401
 *   Webhook secret missing   → 412
 *   Bad signature            → 401
 *   Parse error              → 400
 *   DB error                 → 500
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTelephonyProvider } from "@/lib/telephony";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import { ensureConversationForCall } from "@/modules/voice/conversation-sync";
import {
  renderIvrResponse,
  type IvrProvider,
} from "@/lib/telephony/xml";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;

type RouteContext = { params: Promise<{ tenantToken: string }> };

// Map DB telephonyProvider values to IvrProvider enum
function toIvrProvider(dbProvider: string | null): IvrProvider | null {
  switch ((dbProvider ?? "").toLowerCase()) {
    case "exotel": return "EXOTEL";
    case "plivo": return "PLIVO";
    case "twilio": return "TWILIO";
    default: return null;
  }
}

// ── Inbound call payload (provider-normalised) ────────────────────────────────

interface InboundCallBody {
  /** Provider-assigned call identifier (callsid / CallUUID / CallSid) */
  callSid?: string;
  CallSid?: string;
  CallUUID?: string;
  /** Caller's phone number */
  From?: string;
  from?: string;
  /** Called number (tenant's DID) */
  To?: string;
  to?: string;
  /** Provider hint for language detection */
  language?: string;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, context: RouteContext) {
  const { tenantToken } = await context.params;

  // ── 1. Resolve tenant ─────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { intakeToken: tenantToken },
    select: {
      id: true,
      telephonyProvider: true,
      telephonyApiSecret: true,
      voiceAgentEnabled: true,
      voiceAgentSystemPrompt: true,
      voiceAgentLanguages: true,
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Invalid tenant token" }, { status: 401 });
  }

  if (!tenant.voiceAgentEnabled) {
    return NextResponse.json({ error: "Voice agent not enabled for this tenant" }, { status: 403 });
  }

  // ── 2. Signature verification (Phase 6h — decrypt + fail-closed) ─────────
  // telephonyApiSecret is stored encrypted (v1:...) by the Phase 6g UI; must
  // decrypt before passing to the provider's HMAC verifier.
  //
  // If the tenant has configured telephony, any error in the verification
  // pipeline (decrypt failure, provider factory failure, signature mismatch)
  // MUST fail closed. Previously the catch block swallowed the error and let
  // the request through unauthenticated — that was a free DoS / pay-to-play
  // (STT/TTS spend) vector for anyone who knew the intakeToken.
  const rawBody = await req.text();

  if (tenant.telephonyProvider && tenant.telephonyApiSecret) {
    try {
      const provider = await getTelephonyProvider(tenant.id);
      const webhookSecret = decryptIfEncrypted(tenant.telephonyApiSecret);
      const signature = req.headers.get("x-voice-signature");
      const valid = provider.verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!valid) {
        return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
      }
    } catch (err) {
      console.error(
        `[VoiceWebhook] Signature verification error for tenant ${tenant.id}:`,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 401 },
      );
    }
  } else if (tenant.telephonyProvider || tenant.telephonyApiSecret) {
    // Partial config — one of provider/secret set but not both. Fail loud.
    return NextResponse.json(
      { error: "Telephony provider not fully configured" },
      { status: 412 },
    );
  }
  // Both null = telephony not configured at all; allow (legacy behaviour for
  // test/dev setups where the IVR is exercised without real telephony).

  // ── 3. Parse body ─────────────────────────────────────────────────────────
  let body: InboundCallBody;
  try {
    body = JSON.parse(rawBody) as InboundCallBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const callSid = body.callSid ?? body.CallSid ?? body.CallUUID ?? null;
  const fromNumber = body.From ?? body.from ?? null;
  const toNumber = body.To ?? body.to ?? null;

  if (!callSid || !fromNumber || !toNumber) {
    return NextResponse.json(
      { error: "Missing required fields: callSid/From/To" },
      { status: 400 },
    );
  }

  // ── 4. Create VoiceCall ───────────────────────────────────────────────────
  let voiceCallId: string;
  try {
    const voiceCall = await anyPrisma.voiceCall.create({
      data: {
        tenantId: tenant.id,
        direction: "INBOUND",
        fromNumber,
        toNumber,
        providerCallSid: callSid,
        status: "RINGING",
        language: body.language ?? (tenant.voiceAgentLanguages?.[0] ?? "en-IN"),
      },
      select: { id: true },
    });
    voiceCallId = voiceCall.id as string;
  } catch (err) {
    console.error(`[VoiceWebhook] Failed to create VoiceCall for tenant ${tenant.id}:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 5. Link conversation (fire-and-forget) ─────────────────────────────
  void ensureConversationForCall(voiceCallId).catch((err) => {
    console.warn(
      `[VoiceWebhook] ensureConversationForCall failed for call ${voiceCallId}:`,
      err instanceof Error ? err.message : err,
    );
  });

  // ── 6. Update call status to IN_PROGRESS ─────────────────────────────────
  void anyPrisma.voiceCall.update({
    where: { id: voiceCallId },
    data: { status: "IN_PROGRESS", answeredAt: new Date() },
  }).catch((err: unknown) => {
    console.warn(`[VoiceWebhook] Failed to update call status for ${voiceCallId}:`, err);
  });

  // ── 7. Return greeting ────────────────────────────────────────────────────
  const baseUrl = req.nextUrl.origin;
  const greeting =
    tenant.voiceAgentSystemPrompt
      ? "Hello! How can I assist you with your travel plans today?"
      : "Thank you for calling. How can I help you today?";

  const nextWebhookUrl = `${baseUrl}/api/webhooks/voice/${tenantToken}/turn`;
  const jsonPayload = {
    playText: greeting,
    action: "CONTINUE",
    nextWebhookUrl,
    voiceCallId,
  };

  // Return XML for telephony providers; JSON for debug/test (?format=json)
  const wantsJson = req.nextUrl.searchParams.get("format") === "json";
  const ivrProvider = toIvrProvider(tenant.telephonyProvider);

  if (!wantsJson && ivrProvider) {
    const xml = renderIvrResponse(ivrProvider, { playText: greeting });
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  return NextResponse.json(jsonPayload);
}
