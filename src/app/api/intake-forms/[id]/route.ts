/**
 * src/app/api/intake-forms/[id]/route.ts
 *
 * T35 — IntakeForm get / rename / pause / activate / delete.
 *
 * GET    /api/intake-forms/:id  — fetch single form
 * PATCH  /api/intake-forms/:id  — rename, change status (ACTIVE / PAUSED)
 * DELETE /api/intake-forms/:id  — hard delete (COMPANY_ADMIN only)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requireAuth();

    if (user.role === "AGENT" || user.role === "VIEWER") return forbidden();

    const form = await db.intakeForm.findFirst({
      where: { id },
      include: { department: { select: { id: true, name: true } } },
    });

    if (!form) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // DEPT_MANAGER: only their department's forms
    if (user.role === "DEPT_MANAGER" && user.departmentId && form.departmentId !== user.departmentId) {
      return forbidden();
    }

    return NextResponse.json({ form });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/intake-forms/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch intake form" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("settings:integrations");

    const form = await db.intakeForm.findFirst({ where: { id } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (body.status === "ACTIVE" || body.status === "PAUSED" || body.status === "PENDING_REVIEW") {
      updates.status = body.status;
    }
    if (typeof body.departmentId === "string" || body.departmentId === null) {
      updates.departmentId = body.departmentId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.intakeForm.update({ where: { id }, data: updates });
    return NextResponse.json({ form: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("PATCH /api/intake-forms/[id] error:", err);
    return NextResponse.json({ error: "Failed to update intake form" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const form = await db.intakeForm.findFirst({ where: { id } });
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.intakeForm.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("DELETE /api/intake-forms/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete intake form" }, { status: 500 });
  }
}
