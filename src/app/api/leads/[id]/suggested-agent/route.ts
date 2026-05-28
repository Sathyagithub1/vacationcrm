import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { findBestAgent } from "@/modules/analytics/agent-matcher.service";

// GET /api/leads/[id]/suggested-agent — return ranked agent recommendations for this lead
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("leads:assign");

    // Fetch lead with the fields needed for matching
    const lead = await db.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        id: true,
        departmentId: true,
        assignedTo: true,
        source: true,
        priority: true,
        destination: true,
      },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // RBAC: dept managers can only act on their own department's leads
    if (user.role === "DEPT_MANAGER" && user.departmentId && lead.departmentId !== user.departmentId) {
      return forbidden();
    }

    // Lead.departmentId is nullable (Phase 6a). Suggestions need a department
    // to search within — return an empty list when none is set yet.
    if (!lead.departmentId) {
      return NextResponse.json({ leadId: id, suggestions: [] });
    }

    const rankedAgents = await findBestAgent(db, user.tenantId, lead.departmentId, {
      source: lead.source,
      priority: lead.priority,
      destination: lead.destination ?? undefined,
      departmentId: lead.departmentId,
    });

    return NextResponse.json({
      leadId: id,
      suggestions: rankedAgents,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/leads/[id]/suggested-agent error:", error);
    return NextResponse.json({ error: "Failed to fetch agent suggestions" }, { status: 500 });
  }
}
