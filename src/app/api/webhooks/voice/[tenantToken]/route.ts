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
 * Flow (initial inbound call — no ?ivr stage):
 *   1. Resolve tenant by intakeToken
 *   2. Verify provider webhook signature (X-Voice-Signature header)
 *   3. Parse call metadata (CallSid/CallUUID, From, To)
 *   4. Create VoiceCall record (status: IN_PROGRESS)
 *   5. Run ensureConversationForCall to link caller to a Conversation
 *   6. Return greeting + LANGUAGE menu — XML for providers, JSON for debug
 *
 * IVR DTMF state machine (Phase 6j):
 *   The provider POSTs the pressed digit back to this same webhook, with the
 *   IVR stage carried in the `?ivr=` query param (the `action` URL we emit in
 *   each <Gather>/<GetDigits>). Signature verification + tenant fail-closed
 *   run on EVERY hit; the VoiceCall row is created ONLY on the initial hit.
 *
 *     (no ?ivr)      → create call, greet, present LANGUAGE menu   (action ?ivr=lang)
 *     ?ivr=lang      → resolve chosen language, present DEPARTMENT menu
 *                                                                  (action ?ivr=dept&lang=..)
 *     ?ivr=dept      → resolve department by digit → TRANSFER to its contactPhone
 *                      (fallback: reprompt on invalid, or hand to /turn agent /
 *                       default department when no phone configured)
 *
 * Response shape:
 *   Default: Content-Type application/xml (ExoML / PHML / TwiML per provider)
 *   ?format=json: JSON { playText, action, nextWebhookUrl, voiceCallId, ... }
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
  renderLanguageMenu,
  renderDepartmentMenu,
  buildMenuPrompt,
  type IvrProvider,
  type MenuOption,
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
    case "frejun": return "FREJUN";
    default: return null;
  }
}

// ── Language labels for the DTMF language menu ────────────────────────────────
// lang-codes.ts holds the STT/TTS BCP-47 mapping but no human labels; the menu
// needs spoken names. Keep this list in sync with the tenant.voiceAgentLanguages
// the operator configures (values are BCP-47 tags accepted by toGoogleLangCode).
const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "pa-IN": "Punjabi",
  "ur-IN": "Urdu",
};

function labelForLanguage(code: string): string {
  return LANGUAGE_LABELS[code] ?? LANGUAGE_LABELS[`${code}-IN`] ?? code;
}

/**
 * Build the ordered list of language menu options from the tenant's configured
 * languages (falls back to English-only). Digits are assigned 1..N in order.
 */
function buildLanguageOptions(langs: string[] | null | undefined): MenuOption[] {
  const list = (langs && langs.length > 0 ? langs : ["en-IN"]).slice(0, 9);
  return list.map((code, i) => ({
    digit: String(i + 1),
    label: labelForLanguage(code),
    value: code,
  }));
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
  /** DTMF digit(s) the caller pressed (Twilio/Exotel: Digits; Plivo: digits). */
  Digits?: string;
  digits?: string;
  /** Existing VoiceCall id carried across IVR stages (our own action URL). */
  voiceCallId?: string;
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
  const digit = (body.Digits ?? body.digits ?? "").trim();

  // ── Common response context ───────────────────────────────────────────────
  const baseUrl = req.nextUrl.origin;
  const selfUrl = `${baseUrl}/api/webhooks/voice/${tenantToken}`;
  const nextWebhookUrl = `${baseUrl}/api/webhooks/voice/${tenantToken}/turn`;
  const wantsJson = req.nextUrl.searchParams.get("format") === "json";
  const ivrProvider = toIvrProvider(tenant.telephonyProvider);
  const ivrStage = req.nextUrl.searchParams.get("ivr"); // null | "lang" | "dept"

  /** Return XML for telephony providers; JSON for debug/test (?format=json). */
  function respond(xml: string, json: Record<string, unknown>): Response {
    if (!wantsJson && ivrProvider) {
      return new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }
    return NextResponse.json(json);
  }

  const languageOptions = buildLanguageOptions(tenant.voiceAgentLanguages);

  // ══════════════════════════════════════════════════════════════════════════
  // IVR STAGE: language chosen → present the DEPARTMENT menu
  // ══════════════════════════════════════════════════════════════════════════
  if (ivrStage === "lang") {
    // Resolve chosen language from the pressed digit; fall back to the first
    // configured language (default) on invalid / empty input.
    const chosen =
      languageOptions.find((o) => o.digit === digit)?.value ??
      languageOptions[0]?.value ??
      "en-IN";

    // Load active departments (tenant-scoped) for the department menu.
    const departments = (await prisma.department.findMany({
      where: { tenantId: tenant.id, isActive: true },
      select: { id: true, name: true, contactPhone: true },
      orderBy: { createdAt: "asc" },
      take: 9,
    })) as { id: string; name: string; contactPhone: string | null }[];

    // No departments configured → skip the menu, hand straight to the agent turn.
    if (departments.length === 0) {
      const playText = "Thank you. How can I help you today?";
      return respond(
        renderIvrResponse(ivrProvider ?? "TWILIO", { playText }),
        { playText, action: "CONTINUE", nextWebhookUrl, language: chosen },
      );
    }

    const deptOptions: MenuOption[] = departments.map((d, i) => ({
      digit: String(i + 1),
      label: d.name,
      value: d.id,
    }));

    const deptActionUrl = `${selfUrl}?ivr=dept&lang=${encodeURIComponent(chosen)}`;
    const deptIntro = "Please choose a department.";
    const xml = renderDepartmentMenu(ivrProvider ?? "TWILIO", deptOptions, deptActionUrl, {
      intro: deptIntro,
    });
    return respond(xml, {
      playText: buildMenuPrompt(deptIntro, deptOptions),
      action: "GATHER",
      stage: "dept",
      language: chosen,
      options: deptOptions,
      actionUrl: deptActionUrl,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IVR STAGE: department chosen → route the caller
  // ══════════════════════════════════════════════════════════════════════════
  if (ivrStage === "dept") {
    const chosenLang = req.nextUrl.searchParams.get("lang") ?? "en-IN";

    const departments = (await prisma.department.findMany({
      where: { tenantId: tenant.id, isActive: true },
      select: { id: true, name: true, contactPhone: true },
      orderBy: { createdAt: "asc" },
      take: 9,
    })) as { id: string; name: string; contactPhone: string | null }[];

    const deptOptions: MenuOption[] = departments.map((d, i) => ({
      digit: String(i + 1),
      label: d.name,
      value: d.id,
    }));

    const matchedIdx = deptOptions.findIndex((o) => o.digit === digit);
    const matched = matchedIdx >= 0 ? departments[matchedIdx] : null;

    // Fallback: invalid / no digit → reprompt the department menu once. We use
    // a bounded retry flag (?retry=1) so we never loop forever; a second failure
    // hands the caller to the conversational agent instead.
    if (!matched) {
      const retried = req.nextUrl.searchParams.get("retry") === "1";
      if (!retried && departments.length > 0) {
        const deptActionUrl =
          `${selfUrl}?ivr=dept&lang=${encodeURIComponent(chosenLang)}&retry=1`;
        const xml = renderDepartmentMenu(ivrProvider ?? "TWILIO", deptOptions, deptActionUrl, {
          intro: "Sorry, I didn't get that. Please choose a department.",
        });
        return respond(xml, {
          playText: "Sorry, I didn't get that. Please choose a department.",
          action: "GATHER",
          stage: "dept",
          language: chosenLang,
          options: deptOptions,
          actionUrl: deptActionUrl,
        });
      }
      // Exhausted retry → hand to the conversational agent turn.
      const playText = "Let me connect you to an assistant. How can I help you today?";
      return respond(
        renderIvrResponse(ivrProvider ?? "TWILIO", { playText }),
        { playText, action: "CONTINUE", nextWebhookUrl, language: chosenLang },
      );
    }

    // Matched a department. If it has a contact phone → transfer; otherwise hand
    // to the conversational agent turn scoped to that department.
    if (matched.contactPhone?.trim()) {
      const playText = `Connecting you to ${matched.name}.`;
      return respond(
        renderIvrResponse(ivrProvider ?? "TWILIO", {
          playText,
          transferTo: matched.contactPhone.trim(),
        }),
        {
          playText,
          action: "TRANSFER",
          departmentId: matched.id,
          transferTo: matched.contactPhone.trim(),
          language: chosenLang,
        },
      );
    }

    const playText = `Thank you. You've reached ${matched.name}. How can I help you today?`;
    return respond(
      renderIvrResponse(ivrProvider ?? "TWILIO", { playText }),
      {
        playText,
        action: "CONTINUE",
        nextWebhookUrl,
        departmentId: matched.id,
        language: chosenLang,
      },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INITIAL INBOUND CALL (no ?ivr stage) — requires call metadata
  // ══════════════════════════════════════════════════════════════════════════
  if (!callSid || !fromNumber || !toNumber) {
    return NextResponse.json(
      { error: "Missing required fields: callSid/From/To" },
      { status: 400 },
    );
  }

  // ── 4. Create VoiceCall directly in IN_PROGRESS state ────────────────────
  // Phase 6i — previously created in RINGING then fire-and-forget update to
  // IN_PROGRESS, which raced with the /turn webhook (a late RINGING→IN_PROGRESS
  // write could resurrect a row already flipped to COMPLETED). Fold both writes
  // into the initial create so there's no race window.
  let voiceCallId: string;
  try {
    const voiceCall = await anyPrisma.voiceCall.create({
      data: {
        tenantId: tenant.id,
        direction: "INBOUND",
        fromNumber,
        toNumber,
        providerCallSid: callSid,
        status: "IN_PROGRESS",
        answeredAt: new Date(),
        language: body.language ?? (tenant.voiceAgentLanguages?.[0] ?? "en-IN"),
      },
      select: { id: true },
    });
    voiceCallId = voiceCall.id as string;
  } catch (err) {
    console.error(`[VoiceWebhook] Failed to create VoiceCall for tenant ${tenant.id}:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // ── 5. Link conversation (fire-and-forget; bounded by single retry) ─────
  void ensureConversationForCall(voiceCallId).catch((err) => {
    console.warn(
      `[VoiceWebhook] ensureConversationForCall failed for call ${voiceCallId}:`,
      err instanceof Error ? err.message : err,
    );
  });

  // ── 7. Return greeting + LANGUAGE menu ────────────────────────────────────
  const greeting =
    tenant.voiceAgentSystemPrompt
      ? "Hello! How can I assist you with your travel plans today?"
      : "Thank you for calling. How can I help you today?";

  // If more than one language is configured, present the language DTMF menu;
  // the pressed digit is POSTed back to ?ivr=lang which then shows departments.
  // With a single language there's nothing to pick — skip straight to greeting.
  if (languageOptions.length > 1) {
    const langActionUrl = `${selfUrl}?ivr=lang`;
    const langIntro = `${greeting} Please select your language.`;
    const xml = renderLanguageMenu(ivrProvider ?? "TWILIO", languageOptions, langActionUrl, {
      intro: langIntro,
    });
    return respond(xml, {
      playText: buildMenuPrompt(langIntro, languageOptions),
      action: "GATHER",
      stage: "lang",
      options: languageOptions,
      actionUrl: langActionUrl,
      nextWebhookUrl,
      voiceCallId,
    });
  }

  // Single language configured → plain greeting (legacy behaviour preserved).
  return respond(
    renderIvrResponse(ivrProvider ?? "TWILIO", { playText: greeting }),
    {
      playText: greeting,
      action: "CONTINUE",
      nextWebhookUrl,
      voiceCallId,
    },
  );
}
