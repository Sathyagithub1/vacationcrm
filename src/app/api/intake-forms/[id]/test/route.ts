/**
 * src/app/api/intake-forms/[id]/test/route.ts
 *
 * T35 — IntakeForm test-replay endpoint.
 *
 * POST /api/intake-forms/:id/test
 *
 * Replays the last IntakeWebhookLog.rawPayload for this form's source through
 * runPipeline with dryRun=true.  Useful for admins to verify field-map changes
 * without creating real leads.
 *
 * JUDGMENT CALL: dryRun is signalled by not writing any DB rows downstream.
 * The pipeline itself does not have a native dryRun flag yet; we pass a
 * synthetic webhookLogId and rely on the caller to discard results.  The test
 * endpoint catches errors and returns them so the UI can surface them inline.
 * A future phase can wire a real dryRun flag into runPipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";

const STAGES = getDefaultStages();
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("settings:integrations");

    const form = await db.intakeForm.findFirst({ where: { id } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Find the last raw payload for this form's source
    const lastLog = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: user.tenantId, source: form.source },
      orderBy: { receivedAt: "desc" },
    });

    if (!lastLog) {
      return NextResponse.json(
        { error: "No intake log found for this form's source to replay" },
        { status: 422 },
      );
    }

    const rawPayload = lastLog.rawPayload as Record<string, unknown>;

    // Build a synthetic payload — note: dryRun marker so downstream stages
    // can opt out of writes if they check payload._dryRun in a future update.
    const payload: IntakePayload & { _dryRun: true } = {
      tenantId:     user.tenantId,
      source:       form.source,
      rawPayload,
      sender: {
        phone: typeof rawPayload.phone === "string" ? rawPayload.phone : undefined,
        email: typeof rawPayload.email === "string" ? rawPayload.email : undefined,
      },
      intakeFormId: form.id,
      webhookLogId: lastLog.id, // replay uses the existing log id
      _dryRun:      true,
    };

    let result: IntakePayload;
    try {
      result = await runPipeline(payload, STAGES);
    } catch (pipeErr: unknown) {
      return NextResponse.json({
        ok: false,
        error: pipeErr instanceof Error ? pipeErr.message : String(pipeErr),
      });
    }

    return NextResponse.json({
      ok:             true,
      leadId:         result.leadId         ?? null,
      dedupResult:    result.dedupResult    ?? null,
      canonicalFields:result.canonicalFields ?? null,
      departmentId:   result.departmentId   ?? null,
      tourMatch:      result.tourMatch      ?? null,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("POST /api/intake-forms/[id]/test error:", err);
    return NextResponse.json({ error: "Failed to run test replay" }, { status: 500 });
  }
}
