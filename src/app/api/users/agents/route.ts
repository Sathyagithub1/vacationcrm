/**
 * src/app/api/users/agents/route.ts
 *
 * T38 — Agents picker endpoint.
 *
 * GET /api/users/agents
 *
 * Returns active AGENT users for the authenticated tenant, optionally
 * filtered by departmentId.  Includes openLeadCount (open/assigned leads)
 * via a raw SQL count to avoid N+1 queries.
 *
 * Response shape per agent:
 *   { id, name, email, departmentId, openLeadCount, lastSeenAt }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();

    const { searchParams } = request.nextUrl;
    const departmentId = searchParams.get("departmentId") ?? undefined;

    // Build base filter
    const where: Prisma.UserWhereInput = {
      tenantId: user.tenantId,
      role: "AGENT",
      isActive: true,
      ...(departmentId ? { departmentId } : {}),
    };

    const agents = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        departmentId: true,
        lastSeenAt: true,
      },
      orderBy: { name: "asc" },
    });

    if (agents.length === 0) {
      return NextResponse.json({ agents: [] });
    }

    // Fetch openLeadCount per agent via raw SQL with parameterised values.
    // A lead is "open" when it is assigned to the agent and has no terminal stage
    // (stageId exists — we count all non-null assigned leads as open here,
    // consistent with the assignment eligibility query which uses the same criterion).
    const agentIds = agents.map((a) => a.id);

    const rows = await prisma.$queryRaw<Array<{ assigned_to: string; open_count: bigint }>>`
      SELECT assigned_to, COUNT(*) AS open_count
      FROM   leads
      WHERE  tenant_id   = ${user.tenantId}
        AND  assigned_to = ANY(${agentIds}::text[])
      GROUP  BY assigned_to
    `;

    const countMap = new Map<string, number>();
    for (const row of rows) {
      countMap.set(row.assigned_to, Number(row.open_count));
    }

    const result = agents.map((a) => ({
      id:             a.id,
      name:           a.name,
      email:          a.email,
      departmentId:   a.departmentId,
      openLeadCount:  countMap.get(a.id) ?? 0,
      lastSeenAt:     a.lastSeenAt,
    }));

    return NextResponse.json({ agents: result });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/users/agents error:", err);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}
