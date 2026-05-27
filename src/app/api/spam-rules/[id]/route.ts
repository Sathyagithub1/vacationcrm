/**
 * src/app/api/spam-rules/[id]/route.ts
 *
 * T40 — SpamRule get / deactivate / delete.
 *
 * GET    /api/spam-rules/:id
 * PATCH  /api/spam-rules/:id  — toggle isActive, update reason/expiresAt
 * DELETE /api/spam-rules/:id  — hard delete
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

    const rule = await db.spamRule.findFirst({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch spam rule" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const rule = await db.spamRule.findFirst({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.isActive   === "boolean") updates.isActive   = body.isActive;
    if (typeof body.reason     === "string")  updates.reason     = body.reason;
    if (typeof body.expiresAt  === "string")  updates.expiresAt  = new Date(body.expiresAt);
    if (body.expiresAt === null)              updates.expiresAt  = null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.spamRule.update({ where: { id }, data: updates });
    return NextResponse.json({ rule: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to update spam rule" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const rule = await db.spamRule.findFirst({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.spamRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to delete spam rule" }, { status: 500 });
  }
}
