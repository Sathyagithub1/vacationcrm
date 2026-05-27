/**
 * src/app/api/tags/[id]/route.ts
 *
 * T42 — Tag get / update / delete.
 *
 * GET    /api/tags/:id
 * PATCH  /api/tags/:id  — rename, change color
 * DELETE /api/tags/:id
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
    const { db } = await requireAuth();

    const tag = await db.tag.findFirst({ where: { id } });
    if (!tag) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ tag });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch tag" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const tag = await db.tag.findFirst({ where: { id } });
    if (!tag) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.name  === "string" && body.name.trim())  updates.name  = body.name.trim();
    if (typeof body.color === "string")                       updates.color = body.color;
    if (body.color === null)                                  updates.color = null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.tag.update({ where: { id }, data: updates });
    return NextResponse.json({ tag: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
      if ("code" in err && (err as Record<string, unknown>).code === "P2002") {
        return NextResponse.json({ error: "A tag with this name and scope already exists" }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const tag = await db.tag.findFirst({ where: { id } });
    if (!tag) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.tag.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 });
  }
}
