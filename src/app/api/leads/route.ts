import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { createLead } from "@/modules/leads/leads.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_SOURCES = ["WHATSAPP", "WEBSITE", "FB", "IG", "MANUAL"];
const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "VIP"];

// GET /api/leads — list with filters, search, pagination, RBAC
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const q = searchParams.get("q")?.trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const departmentId = searchParams.get("departmentId") || "";
    const stageId = searchParams.get("stageId") || "";
    const assignedTo = searchParams.get("assignedTo") || "";
    const source = searchParams.get("source") || "";
    const priority = searchParams.get("priority") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const isFutureInterest = searchParams.get("isFutureInterest") || "";

    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

    const where: Record<string, unknown> = {};

    // RBAC filtering
    if (user.role === "DEPT_MANAGER" && user.departmentId) {
      where.departmentId = user.departmentId;
    } else if (user.role === "AGENT") {
      where.assignedTo = user.id;
    }

    // Search across customer name, mobile, destination
    if (q) {
      where.OR = [
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { mobile: { contains: q, mode: "insensitive" } } },
        { destination: { contains: q, mode: "insensitive" } },
      ];
    }

    // Filters
    if (departmentId && user.role !== "DEPT_MANAGER") {
      where.departmentId = departmentId;
    }
    if (stageId) where.stageId = stageId;
    // Phase 6i — `assignedTo=null` is the sentinel for the "Unassigned"
    // filter; otherwise a literal user id is matched. AGENT role still hard-
    // scopes to its own user above, so this override only applies to
    // DEPT_MANAGER / COMPANY_ADMIN.
    if (user.role !== "AGENT") {
      if (assignedTo === "null") where.assignedTo = null;
      else if (assignedTo) where.assignedTo = assignedTo;
    }
    if (source && VALID_SOURCES.includes(source)) where.source = source;
    if (priority && VALID_PRIORITIES.includes(priority)) where.priority = priority;
    if (isFutureInterest === "true") where.isFutureInterest = true;
    if (isFutureInterest === "false") where.isFutureInterest = false;

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};
      if (dateFrom) createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const orderBy: Record<string, string> = {};
    if (sortBy === "updatedAt") {
      orderBy.updatedAt = sortOrder;
    } else {
      orderBy.createdAt = sortOrder;
    }

    const [leads, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, mobile: true, email: true } },
          department: { select: { id: true, name: true, color: true } },
          stage: { select: { id: true, name: true, color: true, position: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      db.lead.count({ where }),
    ]);

    return NextResponse.json({
      leads,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/leads error:", error);
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
  }
}

// POST /api/leads — create a new lead
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("leads:create");

    const body = await request.json();
    const {
      customerName,
      customerMobile,
      customerEmail,
      departmentId,
      destination,
      travelDate,
      numPassengers,
      specialRequirement,
      source,
      priority,
      assignedTo,
      isFutureInterest,
    } = body;

    // Validation
    if (!customerName || typeof customerName !== "string" || !customerName.trim()) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }
    if (!customerMobile || typeof customerMobile !== "string" || !customerMobile.trim()) {
      return NextResponse.json({ error: "Customer mobile is required" }, { status: 400 });
    }
    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "Department is required" }, { status: 400 });
    }

    // Verify department exists
    const dept = await db.department.findFirst({ where: { id: departmentId } });
    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    if (source && !VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const lead = await createLead(
      db,
      {
        customerName: customerName.trim(),
        customerMobile: customerMobile.trim(),
        customerEmail: customerEmail?.trim() || null,
        departmentId,
        destination: destination?.trim() || null,
        travelDate: travelDate || null,
        numPassengers: numPassengers ? parseInt(numPassengers, 10) : null,
        specialRequirement: specialRequirement?.trim() || null,
        source: source || "MANUAL",
        priority: priority || "MEDIUM",
        assignedTo: assignedTo || null,
        isFutureInterest: isFutureInterest || false,
        tenantId: user.tenantId,
      },
      user.id
    );

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "lead.create",
      entityType: "Lead",
      entityId: lead.id,
      newValue: lead,
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message.includes("pipeline stages")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("POST /api/leads error:", error);
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
  }
}
