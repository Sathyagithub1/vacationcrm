import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { scoreLeadById } from "@/modules/analytics/lead-scorer.service";
import { addScoringJob } from "@/lib/queue";

// GET /api/leads/[id]/score — return lead score + breakdown.
// If no score record exists yet, compute synchronously on the fly.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("predictions:view");

    // Verify the lead exists and is scoped to the tenant
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

    // Try to return the cached score first
    const cached = await (db.leadScore as any).findUnique({
      where: { leadId: id },
    });

    // If a non-expired score exists, return it directly
    if (cached && (!cached.expiresAt || cached.expiresAt > new Date())) {
      return NextResponse.json({
        leadId: id,
        score: cached.score,
        tier: cached.tier,
        breakdown: {
          engagement: cached.engagementScore,
          attributes: cached.attributeScore,
          historical: cached.historicalScore,
          conversation: cached.conversationScore,
        },
        previousScore: cached.previousScore,
        previousTier: cached.previousTier,
        scoreChange: cached.scoreChange,
        computedAt: cached.computedAt,
        expiresAt: cached.expiresAt,
        source: "cache",
      });
    }

    // No valid cached score — compute synchronously
    const result = await scoreLeadById(db, user.tenantId, id);

    return NextResponse.json({
      ...result,
      computedAt: new Date(),
      source: "computed",
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message.startsWith("Lead not found")) {
        return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      }
    }
    console.error("GET /api/leads/[id]/score error:", error);
    return NextResponse.json({ error: "Failed to fetch lead score" }, { status: 500 });
  }
}

// POST /api/leads/[id]/score/refresh — force recompute by enqueuing a scoring job
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("predictions:view");

    const lead = await db.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, departmentId: true, assignedTo: true },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (user.role === "DEPT_MANAGER" && user.departmentId && lead.departmentId !== user.departmentId) {
      return forbidden();
    }
    if (user.role === "AGENT" && lead.assignedTo !== user.id) {
      return forbidden();
    }

    const job = await addScoringJob({
      tenantId: user.tenantId,
      leadId: id,
      trigger: "batch",
    });

    return NextResponse.json({
      queued: true,
      jobId: job?.id ?? null,
      message: "Score refresh job enqueued. The updated score will be available shortly.",
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/leads/[id]/score/refresh error:", error);
    return NextResponse.json({ error: "Failed to queue score refresh" }, { status: 500 });
  }
}
