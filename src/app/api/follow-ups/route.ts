import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { createFollowUp, listFollowUps } from "@/modules/follow-ups/follow-up.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_TYPES = ["REMINDER", "QUOTATION", "DOCUMENT", "PAYMENT", "RE_ENGAGE"];
const VALID_STATUSES = ["PENDING", "SENT", "COMPLETED", "CANCELLED"];

// GET /api/follow-ups — list with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get("status") || "";
    const type = searchParams.get("type") || "";
    const assignedTo = searchParams.get("assignedTo") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    // RBAC: Agents only see their own follow-ups;
    // dept managers see only follow-ups linked to leads in their department.
    let effectiveAssignedTo = assignedTo;
    let leadDepartmentId: string | undefined;
    if (user.role === "AGENT") {
      effectiveAssignedTo = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      leadDepartmentId = user.departmentId;
    }

    const result = await listFollowUps(db, {
      status: status && VALID_STATUSES.includes(status) ? status : undefined,
      type: type && VALID_TYPES.includes(type) ? type : undefined,
      assignedTo: effectiveAssignedTo || undefined,
      leadDepartmentId,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/follow-ups error:", error);
    return NextResponse.json({ error: "Failed to fetch follow-ups" }, { status: 500 });
  }
}

// POST /api/follow-ups — create a new follow-up
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("follow-ups:create");

    const body = await request.json();
    const { leadId, assignedTo, type, scheduledAt, messageTemplate } = body;

    if (!leadId || typeof leadId !== "string") {
      return NextResponse.json({ error: "Lead ID is required" }, { status: 400 });
    }
    if (!assignedTo || typeof assignedTo !== "string") {
      return NextResponse.json({ error: "Assignee is required" }, { status: 400 });
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: "Valid follow-up type is required" }, { status: 400 });
    }
    if (!scheduledAt) {
      return NextResponse.json({ error: "Scheduled date is required" }, { status: 400 });
    }

    const followUp = await createFollowUp(db, {
      leadId,
      assignedTo,
      type,
      scheduledAt,
      messageTemplate: messageTemplate || null,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "follow_up.create",
      entityType: "FollowUp",
      entityId: followUp.id,
      newValue: followUp,
    });

    return NextResponse.json({ followUp }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Lead not found" || error.message === "Assignee not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("POST /api/follow-ups error:", error);
    return NextResponse.json({ error: "Failed to create follow-up" }, { status: 500 });
  }
}
