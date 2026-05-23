import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { recordOutcome } from "@/modules/analytics/prediction.service";

// POST /api/leads/[id]/predictions/[predId]/outcome — record the actual outcome
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; predId: string }> }
) {
  try {
    const { id, predId } = await params;
    const { user, db } = await requirePermission("predictions:accept");

    const body = await request.json();
    const { outcome } = body;

    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      return NextResponse.json(
        { error: "Body must include an outcome object" },
        { status: 400 }
      );
    }

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

    // Ensure the prediction belongs to this lead and tenant
    const prediction = await (db.prediction as any).findFirst({
      where: { id: predId, leadId: id, tenantId: user.tenantId },
      select: { id: true },
    });

    if (!prediction) {
      return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
    }

    const updated = await recordOutcome(db, predId, outcome as Record<string, unknown>);

    return NextResponse.json({ prediction: updated });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message.startsWith("Prediction not found")) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("POST /api/leads/[id]/predictions/[predId]/outcome error:", error);
    return NextResponse.json({ error: "Failed to record outcome" }, { status: 500 });
  }
}
