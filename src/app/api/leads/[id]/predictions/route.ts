import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

// GET /api/leads/[id]/predictions — return all predictions for a lead
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("predictions:view");

    // Verify the lead exists within this tenant
    const lead = await db.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, departmentId: true, assignedTo: true },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // RBAC: dept managers see only their department; agents see only their leads
    if (user.role === "DEPT_MANAGER" && user.departmentId && lead.departmentId !== user.departmentId) {
      return forbidden();
    }
    if (user.role === "AGENT" && lead.assignedTo !== user.id) {
      return forbidden();
    }

    const predictions = await (db.prediction as any).findMany({
      where: { leadId: id, tenantId: user.tenantId },
      orderBy: { computedAt: "desc" },
    });

    return NextResponse.json({ predictions });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/leads/[id]/predictions error:", error);
    return NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 });
  }
}
