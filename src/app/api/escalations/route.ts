import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { createEscalation } from "@/modules/escalations/escalation.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_REASONS = [
  "REPEATED_FAILURE",
  "COMPLEX_REQUEST",
  "PAYMENT_ISSUE",
  "TECHNICAL_ISSUE",
  "VIP_CLIENT",
  "CUSTOMER_REQUEST",
];

// GET /api/escalations — list escalations
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get("status") || "";
    const leadId = searchParams.get("leadId") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // RBAC: agents only see escalations they created or are assigned to
    if (user.role === "AGENT") {
      where.OR = [
        { escalatedFrom: user.id },
        { escalatedTo: user.id },
      ];
    }

    if (status) where.status = status;
    if (leadId) where.leadId = leadId;

    const [escalations, total] = await Promise.all([
      db.escalation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          lead: {
            include: {
              customer: { select: { id: true, name: true, mobile: true } },
              department: { select: { id: true, name: true } },
            },
          },
          fromUser: { select: { id: true, name: true, avatarUrl: true } },
          toUser: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      db.escalation.count({ where }),
    ]);

    return NextResponse.json({
      escalations,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/escalations error:", error);
    return NextResponse.json({ error: "Failed to fetch escalations" }, { status: 500 });
  }
}

// POST /api/escalations — create an escalation
export async function POST(request: Request) {
  try {
    const { user, db } = await requireAuth();

    const body = await request.json();
    const { leadId, conversationId, reason, escalatedTo, notes } = body;

    if (!leadId || typeof leadId !== "string") {
      return NextResponse.json({ error: "Lead ID is required" }, { status: 400 });
    }
    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: "Valid escalation reason is required" }, { status: 400 });
    }
    if (!escalatedTo || typeof escalatedTo !== "string") {
      return NextResponse.json({ error: "Escalation target user is required" }, { status: 400 });
    }

    const escalation = await createEscalation(db, {
      leadId,
      conversationId: conversationId || null,
      reason,
      escalatedFrom: user.id,
      escalatedTo,
      notes: notes?.trim() || null,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "escalation.create",
      entityType: "Escalation",
      entityId: escalation.id,
      newValue: escalation,
    });

    return NextResponse.json({ escalation }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (
        error.message === "Lead not found" ||
        error.message === "Target user not found" ||
        error.message === "Source user not found" ||
        error.message === "Conversation not found"
      ) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("POST /api/escalations error:", error);
    return NextResponse.json({ error: "Failed to create escalation" }, { status: 500 });
  }
}
