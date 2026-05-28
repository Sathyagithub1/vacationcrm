/**
 * src/app/api/assignment-pools/[id]/route.ts
 *
 * T37 — Assignment pool get / update / delete.
 *
 * GET    /api/assignment-pools/:id
 * PATCH  /api/assignment-pools/:id  — update name, agentIds, priority, isActive
 * DELETE /api/assignment-pools/:id
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

    const pool = await db.assignmentPool.findFirst({
      where: { id },
      include: { department: { select: { id: true, name: true } } },
    });

    if (!pool) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ pool });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch pool" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const pool = await db.assignmentPool.findFirst({ where: { id } });
    if (!pool) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.priority === "number") updates.priority = body.priority;
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    if (Array.isArray(body.sourceMatch)) updates.sourceMatch = body.sourceMatch;
    if (typeof body.departmentId === "string" || body.departmentId === null) {
      updates.departmentId = body.departmentId;
    }

    if (Array.isArray(body.agentIds)) {
      if (!body.agentIds.every((id) => typeof id === "string")) {
        return NextResponse.json({ error: "agentIds must be strings" }, { status: 400 });
      }

      // Validate agents
      if (body.agentIds.length > 0) {
        const agents = await db.user.findMany({
          where: { id: { in: body.agentIds as string[] }, role: "AGENT", isActive: true },
          select: { id: true },
        });
        const foundIds = new Set(agents.map((a) => a.id));
        const missing = (body.agentIds as string[]).filter((a) => !foundIds.has(a));
        if (missing.length > 0) {
          return NextResponse.json(
            { error: `Invalid agentIds: ${missing.join(", ")}` },
            { status: 400 },
          );
        }
      }
      updates.agentIds = body.agentIds;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.assignmentPool.update({ where: { id }, data: updates });
    return NextResponse.json({ pool: updated });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to update pool" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requirePermission("settings:integrations");

    const pool = await db.assignmentPool.findFirst({ where: { id } });
    if (!pool) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.assignmentPool.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to delete pool" }, { status: 500 });
  }
}
