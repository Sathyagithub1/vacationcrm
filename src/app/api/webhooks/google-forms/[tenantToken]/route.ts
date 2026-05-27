/**
 * src/app/api/webhooks/google-forms/[tenantToken]/route.ts
 *
 * T34 — Google Forms intake webhook.
 * POST /api/webhooks/google-forms/:tenantToken
 *
 * Authentication model:
 *   1. Tenant resolved by intakeToken in the URL path segment (same as T32).
 *   2. HMAC-SHA256 of the raw request body using tenant.googleFormsKey.
 *      Header: X-Signature: sha256=<hex>
 *
 * If tenant.googleFormsKey is null the endpoint returns 412 Precondition
 * Failed — the admin must configure a signing key before the Apps Script
 * template can be used.
 *
 * Environment vars required:
 *   (none — key lives in the Tenant row, not in env)
 *
 * See docs/intake/google-forms-template.gs for the companion Apps Script.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";

// Build stages once at module load to keep hot path allocation-free.
const STAGES = getDefaultStages();

type RouteContext = { params: Promise<{ tenantToken: string }> };

/**
 * POST /api/webhooks/google-forms/[tenantToken]
 *
 * Status codes:
 *   200  — pipeline ran (or dedup hit)
 *   400  — malformed JSON body
 *   401  — tenantToken not recognised OR HMAC mismatch
 *   412  — googleFormsKey not configured for this tenant
 *   500  — pipeline threw an unexpected error
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const { tenantToken } = await context.params;

  // ── 1. Resolve tenant ─────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { intakeToken: tenantToken },
    select: { id: true, googleFormsKey: true },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Invalid tenant token" }, { status: 401 });
  }

  // ── 2. Check signing key is configured ───────────────────────────────────
  if (!tenant.googleFormsKey) {
    return NextResponse.json(
      { error: "Google Forms key not configured for this tenant" },
      { status: 412 },
    );
  }

  // ── 3. Read raw body (must come before req.json() to preserve the bytes) ─
  const rawBody = await req.text();

  // ── 4. Verify X-Signature HMAC-SHA256 ────────────────────────────────────
  const sigHeader = req.headers.get("x-signature");

  if (!sigHeader) {
    return NextResponse.json({ error: "Missing X-Signature header" }, { status: 401 });
  }

  const expectedSig =
    "sha256=" +
    createHmac("sha256", tenant.googleFormsKey).update(rawBody, "utf8").digest("hex");

  let sigValid: boolean;
  try {
    sigValid = timingSafeEqual(
      Buffer.from(sigHeader, "utf8"),
      Buffer.from(expectedSig, "utf8"),
    );
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // ── 5. Parse body JSON ────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── 6. Map well-known Google Forms field names to canonical fields ────────
  // The Apps Script sends namedValues as a flat object. Support common aliases.
  const email =
    typeof body.email === "string" ? body.email : undefined;

  const name =
    typeof body.name === "string"
      ? body.name
      : typeof body.fullName === "string"
        ? body.fullName
        : typeof body.full_name === "string"
          ? body.full_name
          : undefined;

  const phone =
    typeof body.phone === "string"
      ? body.phone
      : typeof body.mobile === "string"
        ? body.mobile
        : typeof body.phone_number === "string"
          ? body.phone_number
          : undefined;

  // ── 7. Write IntakeWebhookLog ─────────────────────────────────────────────
  const log = await prisma.intakeWebhookLog.create({
    data: {
      tenantId: tenant.id,
      source: "GOOGLE_FORMS",
      endpoint: `/api/webhooks/google-forms/${tenantToken}`,
      rawPayload: body,
      signatureValid: true,
      processed: false,
    },
    select: { id: true },
  });

  // ── 8. Build IntakePayload ────────────────────────────────────────────────
  const payload: IntakePayload = {
    tenantId: tenant.id,
    source: "GOOGLE_FORMS",
    rawPayload: body,
    sender: { phone, email },
    webhookLogId: log.id,
    // Populate canonicalFields so normalize stage has a head start
    canonicalFields: {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(email !== undefined ? { email } : {}),
    },
  };

  // ── 9. Run pipeline ───────────────────────────────────────────────────────
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
