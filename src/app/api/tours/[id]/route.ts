/**
 * src/app/api/tours/[id]/route.ts
 *
 * T39 — Tour get / update / delete.
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
    if (user.role === "AGENT") return forbidden();

    const tour = await db.tour.findFirst({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { bookings: true } },
      },
    });

    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ tour });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch tour" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const tour = await db.tour.findFirst({ where: { id } });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.name        === "string") updates.name        = body.name.trim();
    if (typeof body.description === "string") updates.description = body.description.trim();
    if (typeof body.status      === "string") updates.status      = body.status;
    if (typeof body.capacity    === "number") {
      if (body.capacity < 1) return NextResponse.json({ error: "capacity must be ≥ 1" }, { status: 400 });
      updates.capacity = body.capacity;
    }
    if (typeof body.startDate === "string") updates.startDate = new Date(body.startDate);
    if (typeof body.endDate   === "string") updates.endDate   = new Date(body.endDate);
    if (Array.isArray(body.tagIds)) updates.tagIds = body.tagIds;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.tour.update({ where: { id }, data: updates });
    return NextResponse.json({ tour: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to update tour" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const tour = await db.tour.findFirst({ where: { id } });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.tour.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to delete tour" }, { status: 500 });
  }
}
