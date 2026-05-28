/**
 * src/app/api/webhooks/voice/[tenantToken]/turn/route.ts
 *
 * Phase 6d — IVR per-turn webhook handler (tenant-scoped).
 *
 * URL: POST /api/webhooks/voice/:tenantToken/turn
 *
 * Called by the telephony provider after each customer utterance is
 * transcribed (STT) or typed (DTMF).  Routes to the voice agent dialogue
 * engine, then returns the next action + text to play.
 *
 * Request body:
 *   {
 *     voiceCallId: string;         // Holiday Delight VoiceCall ID
 *     utterance: string;           // Transcribed customer speech / DTMF input
 *     callSid?: string;            // Provider call identifier (for validation)
 *     language?: string;           // BCP-47 override (optional)
 *   }
 *
 * Response shape (v1 — provider-independent JSON):
 *   CONTINUE:
 *     { playText: string; action: "CONTINUE"; nextWebhookUrl: string }
 *   TRANSFER:
 *     { playText: string; action: "TRANSFER"; transferTo: string }
 *   CALLBACK:
 *     { playText: string; action: "CALLBACK" }
 *   END:
 *     { playText: string; action: "END" }
 *
 * TODO 6D-B4: Translate JSON to provider-specific XML at the edge.
 *
 * Error handling:
 *   Unknown tenantToken → 401
 *   Missing voiceCallId → 400
 *   Mismatched tenant   → 403
 *   DB/AI error         → 500 with fail-soft message
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runVoiceAgentTurn } from "@/modules/voice/agent";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;

type RouteContext = { params: Promise<{ tenantToken: string }> };

interface TurnBody {
  voiceCallId: string;
  utterance: string;
  callSid?: string;
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
      telephonyPhoneNumber: true,
      voiceAgentEnabled: true,
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Invalid tenant token" }, { status: 401 });
  }

  if (!tenant.voiceAgentEnabled) {
    return NextResponse.json({ error: "Voice agent not enabled" }, { status: 403 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { voiceCallId, utterance } = body;

  if (!voiceCallId || !utterance?.trim()) {
    return NextResponse.json(
      { error: "Missing required fields: voiceCallId, utterance" },
      { status: 400 },
    );
  }

  // ── 3. Validate call belongs to this tenant ───────────────────────────────
  const voiceCall = await anyPrisma.voiceCall.findUnique({
    where: { id: voiceCallId },
    select: { tenantId: true, status: true },
  }) as { tenantId: string; status: string } | null;

  if (!voiceCall) {
    return NextResponse.json({ error: "VoiceCall not found" }, { status: 404 });
  }

  if (voiceCall.tenantId !== tenant.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (voiceCall.status === "COMPLETED" || voiceCall.status === "FAILED") {
    return NextResponse.json({ error: "Call is not active" }, { status: 409 });
  }

  // ── 4. Run voice agent turn ───────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof runVoiceAgentTurn>>;
  try {
    result = await runVoiceAgentTurn(voiceCallId, utterance.trim());
  } catch (err) {
    console.error(
      `[VoiceWebhook/turn] runVoiceAgentTurn failed for call ${voiceCallId} ` +
        `(tenant ${tenant.id}):`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      {
        playText: "I'm sorry, I'm having trouble right now. Let me end this call.",
        action: "END",
      },
      { status: 200 },
    );
  }

  // ── 5. Build response ─────────────────────────────────────────────────────
  const baseUrl = req.nextUrl.origin;

  switch (result.nextAction) {
    case "CONTINUE":
      return NextResponse.json({
        playText: result.responseText,
        action: "CONTINUE",
        nextWebhookUrl: `${baseUrl}/api/webhooks/voice/${tenantToken}/turn`,
      });

    case "TRANSFER":
      // Update call status
      void anyPrisma.voiceCall.update({
        where: { id: voiceCallId },
        data: { status: "COMPLETED", intent: "TRANSFER" },
      }).catch(() => undefined);

      return NextResponse.json({
        playText: result.responseText,
        action: "TRANSFER",
        transferTo: tenant.telephonyPhoneNumber ?? null,
      });

    case "CALLBACK":
      // Update call status
      void anyPrisma.voiceCall.update({
        where: { id: voiceCallId },
        data: { status: "COMPLETED", intent: "CALLBACK" },
      }).catch(() => undefined);

      return NextResponse.json({
        playText: result.responseText,
        action: "CALLBACK",
      });

    case "END":
      // Mark call as COMPLETED
      void anyPrisma.voiceCall.update({
        where: { id: voiceCallId },
        data: {
          status: "COMPLETED",
          endedAt: new Date(),
        },
      }).catch(() => undefined);

      return NextResponse.json({
        playText: result.responseText,
        action: "END",
      });
  }
}
