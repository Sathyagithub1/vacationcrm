/**
 * src/app/api/assignment-pools/route.ts
 *
 * T37 — Assignment pools list + create.
 *
 * GET  /api/assignment-pools  — list pools ordered by priority
 * POST /api/assignment-pools  — create pool; validates agentIds are AGENTs of same tenant
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

export async function GET() {
  try {
    const { user, db } = await requireAuth();

    if (user.role === "AGENT" || user.role === "VIEWER") return forbidden();

    const pools = await db.assignmentPool.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: { department: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ pools });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/assignment-pools error:", err);
    return NextResponse.json({ error: "Failed to fetch assignment pools" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const name         = typeof body.name === "string" ? body.name.trim() : null;
    const agentIds     = Array.isArray(body.agentIds)  ? (body.agentIds as unknown[]) : [];
    const sourceMatch  = Array.isArray(body.sourceMatch) ? body.sourceMatch : [];
    const departmentId = typeof body.departmentId === "string" ? body.departmentId : null;
    const priority     = typeof body.priority === "number" ? body.priority : 0;
    const isActive     = body.isActive === false ? false : true;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // All agentIds must be strings
    if (!agentIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "agentIds must be an array of strings" }, { status: 400 });
    }

    // Validate all agentIds are AGENT-role users belonging to this tenant
    if (agentIds.length > 0) {
      const agents = await db.user.findMany({
        where: { id: { in: agentIds as string[] }, role: "AGENT", isActive: true },
        select: { id: true },
      });

      const foundIds = new Set(agents.map((a) => a.id));
      const missing = (agentIds as string[]).filter((id) => !foundIds.has(id));

      if (missing.length > 0) {
        return NextResponse.json(
          { error: `The following agentIds are not active AGENT users of this tenant: ${missing.join(", ")}` },
          { status: 400 },
        );
      }
    }

    // Verify department if supplied
    if (departmentId) {
      const dept = await db.department.findFirst({ where: { id: departmentId } });
      if (!dept) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
    }

    const pool = await db.assignmentPool.create({
      data: {
        tenantId: user.tenantId,
        name,
        agentIds:    agentIds as string[],
        sourceMatch: sourceMatch as never,
        departmentId,
        priority,
        isActive,
      },
    });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("POST /api/assignment-pools error:", err);
    return NextResponse.json({ error: "Failed to create assignment pool" }, { status: 500 });
  }
}
