import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_STATUSES = ["SCHEDULED", "COMPLETED", "MISSED"];

// GET /api/callbacks — list with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get("status") || "";
    const departmentId = searchParams.get("departmentId") || "";
    const assignedTo = searchParams.get("assignedTo") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // RBAC: agents see only their own callbacks
    if (user.role === "AGENT") {
      where.assignedTo = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      where.departmentId = user.departmentId;
    }

    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (departmentId && user.role !== "DEPT_MANAGER") where.departmentId = departmentId;
    if (assignedTo && user.role !== "AGENT") where.assignedTo = assignedTo;

    const [callbacks, total] = await Promise.all([
      db.callback.findMany({
        where,
        orderBy: { preferredTime: "asc" },
        skip,
        take: limit,
        include: {
          lead: {
            include: {
              customer: { select: { id: true, name: true, mobile: true, email: true } },
            },
          },
          department: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      db.callback.count({ where }),
    ]);

    return NextResponse.json({
      callbacks,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/callbacks error:", error);
    return NextResponse.json({ error: "Failed to fetch callbacks" }, { status: 500 });
  }
}

// POST /api/callbacks — create a new callback
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("callbacks:create");

    const body = await request.json();
    const { leadId, departmentId, assignedTo, preferredTime, notes } = body;

    if (!leadId || typeof leadId !== "string") {
      return NextResponse.json({ error: "Lead ID is required" }, { status: 400 });
    }
    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "Department ID is required" }, { status: 400 });
    }
    if (!preferredTime) {
      return NextResponse.json({ error: "Preferred time is required" }, { status: 400 });
    }

    // Verify lead exists
    const lead = await db.lead.findFirst({ where: { id: leadId } });
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Verify department exists
    const dept = await db.department.findFirst({ where: { id: departmentId } });
    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // Verify assignee if provided
    if (assignedTo) {
      const assignee = await db.user.findFirst({ where: { id: assignedTo, isActive: true } });
      if (!assignee) {
        return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
      }
    }

    const callback = await (db.callback.create as Function)({
      data: {
        leadId,
        departmentId,
        assignedTo: assignedTo || null,
        preferredTime: new Date(preferredTime),
        notes: notes?.trim() || null,
        status: "SCHEDULED",
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "callback.create",
      entityType: "Callback",
      entityId: callback.id,
      newValue: callback,
    });

    return NextResponse.json({ callback }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/callbacks error:", error);
    return NextResponse.json({ error: "Failed to create callback" }, { status: 500 });
  }
}
