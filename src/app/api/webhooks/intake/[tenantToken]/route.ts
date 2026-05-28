/**
 * src/app/api/webhooks/intake/[tenantToken]/route.ts
 *
 * T32 — Universal intake webhook.
 * POST /api/webhooks/intake/:tenantToken
 *
 * Accepts any JSON body from any source system.  The caller authenticates by
 * presenting the tenant's secret `intakeToken` in the URL path segment — no
 * additional HMAC signature is required because knowledge of the token IS the
 * credential.
 *
 * Per-tenant feature flag: INTAKE_PIPELINE_V2_ENABLED
 *   tenant.featureFlags.INTAKE_PIPELINE_V2_ENABLED === false → 503
 *   absent key (default '{}')                               → enabled (opt-out)
 *
 * Environment vars required:
 *   (none — this endpoint uses token-in-path auth only)
 *
 * See .env.local for DATABASE_URL and REDIS_URL needed by pipeline stages.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";
import type { LeadSource } from "@prisma/client";

// Build the stages object once at module load — avoids re-importing on every
// request and keeps the hot path allocation-free.
const STAGES = getDefaultStages();

// All valid LeadSource enum values as a Set for O(1) validation.
const VALID_SOURCES = new Set<string>([
  "WHATSAPP",
  "WEBSITE",
  "FB",
  "IG",
  "MANUAL",
  "META_LEAD_AD",
  "GOOGLE_FORMS",
  "WEBSITE_SNIPPET",
  "FORM_BUILDER",
  "EMAIL",
  "MESSENGER",
  "TELEGRAM",
]);

type RouteContext = { params: Promise<{ tenantToken: string }> };

/**
 * POST /api/webhooks/intake/[tenantToken]
 *
 * Status codes:
 *   200 — pipeline ran (or dedup hit — lead already exists)
 *   400 — malformed JSON body or unknown LeadSource value
 *   401 — tenantToken not recognised
 *   503 — pipeline v2 disabled for this tenant (per-tenant flag)
 *   500 — pipeline threw an unexpected error
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { tenantToken } = await context.params;

  // ── 1. Resolve tenant ─────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { intakeToken: tenantToken },
    // featureFlags is per-tenant; read it here so we can gate below.
    select: { id: true, featureFlags: true },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Invalid tenant token" }, { status: 401 });
  }

  // ── 2. Per-tenant pipeline v2 feature flag ────────────────────────────────
  // Convention: featureFlags.INTAKE_PIPELINE_V2_ENABLED === false  → disabled.
  // Absent key or any other value (including true) → enabled (opt-out, backwards-compatible).
  const flags = (tenant.featureFlags ?? {}) as Record<string, unknown>;
  if (flags["INTAKE_PIPELINE_V2_ENABLED"] === false) {
    return NextResponse.json({ error: "Pipeline v2 disabled" }, { status: 503 });
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── 4. Resolve source ─────────────────────────────────────────────────────
  // X-Source header takes precedence over the body `source` field; both fall
  // back to the default "WEBSITE" if absent.
  const rawSource =
    req.headers.get("x-source") ??
    (typeof body.source === "string" ? body.source : undefined) ??
    "WEBSITE";

  const upperSource = rawSource.toUpperCase();
  if (!VALID_SOURCES.has(upperSource)) {
    return NextResponse.json(
      { error: `Unknown source: ${rawSource}. Valid values: ${[...VALID_SOURCES].join(", ")}` },
      { status: 400 },
    );
  }
  const source = upperSource as LeadSource;

  // ── 5. Write IntakeWebhookLog ─────────────────────────────────────────────
  const log = await prisma.intakeWebhookLog.create({
    data: {
      tenantId: tenant.id,
      source,
      endpoint: `/api/webhooks/intake/${tenantToken}`,
      rawPayload: body,
      signatureValid: true, // token-in-path auth — no separate HMAC required
      processed: false,
    },
    select: { id: true },
  });

  // ── 6. Build IntakePayload ────────────────────────────────────────────────
  const payload: IntakePayload = {
    tenantId: tenant.id,
    source,
    rawPayload: body,
    sender: {
      phone: typeof body.phone === "string" ? body.phone : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      channelHandle:
        typeof body._channelHandle === "string" ? body._channelHandle : undefined,
    },
    intakeFormId:
      typeof body._intakeFormId === "string" ? body._intakeFormId : undefined,
    webhookLogId: log.id,
  };

  // ── 7. Run pipeline ───────────────────────────────────────────────────────
  try {
    const result = await runPipeline(payload, STAGES);
    return NextResponse.json({ ok: true, leadId: result.leadId ?? null });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.intakeWebhookLog.update({
      where: { id: log.id },
      data: { processed: false, errorMessage },
    });
    return NextResponse.json({ error: "Pipeline error", detail: errorMessage }, { status: 500 });
  }
}
