/**
 * src/app/api/intake-forms/[id]/field-map/route.ts
 *
 * T35 — IntakeForm field-map endpoints.
 *
 * GET   /api/intake-forms/:id/field-map  — return current fieldMap + last
 *                                          IntakeWebhookLog.rawPayload sample
 * PATCH /api/intake-forms/:id/field-map  — admin confirms fieldMap, sets
 *                                          fieldMappingConfirmed=true + status=ACTIVE
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requireAuth();

    if (user.role === "AGENT" || user.role === "VIEWER") return forbidden();

    const form = await db.intakeForm.findFirst({ where: { id } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Last raw payload sample from IntakeWebhookLog for this form's source
    // Note: IntakeWebhookLog does not have tenantId in a forced tenantPrisma
    // filter, so we query via the raw prisma client with explicit tenantId.
    const lastLog = await prisma.intakeWebhookLog.findFirst({
      where: { tenantId: user.tenantId, source: form.source },
      orderBy: { receivedAt: "desc" },
      select: { rawPayload: true, receivedAt: true },
    });

    return NextResponse.json({
      fieldMap:    form.fieldMap,
      confirmed:   form.fieldMappingConfirmed,
      sample:      lastLog?.rawPayload ?? null,
      sampleAt:    lastLog?.receivedAt ?? null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/intake-forms/[id]/field-map error:", err);
    return NextResponse.json({ error: "Failed to fetch field map" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const form = await db.intakeForm.findFirst({ where: { id } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;

    // fieldMap must be a plain object
    if (!body.fieldMap || typeof body.fieldMap !== "object" || Array.isArray(body.fieldMap)) {
      return NextResponse.json({ error: "fieldMap must be a plain object" }, { status: 400 });
    }

    const updated = await db.intakeForm.update({
      where: { id },
      data: {
        fieldMap:             body.fieldMap as never,
        fieldMappingConfirmed: true,
        status:               "ACTIVE",
      },
    });

    return NextResponse.json({ form: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("PATCH /api/intake-forms/[id]/field-map error:", err);
    return NextResponse.json({ error: "Failed to update field map" }, { status: 500 });
  }
}
