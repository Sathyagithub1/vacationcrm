/**
 * src/app/api/tours/route.ts
 *
 * T39 — Tours list + create.
 *
 * GET  /api/tours  — paginated list with optional status/dept filters
 * POST /api/tours  — create tour; validates unique code per tenant, capacity ≥ 1
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();

    if (user.role === "AGENT") return forbidden();

    const { searchParams } = request.nextUrl;
    const page   = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip   = (page - 1) * limit;
    const status = searchParams.get("status") ?? undefined;
    const deptId = searchParams.get("departmentId") ?? undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (deptId) where.departmentId = deptId;
    else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      where.departmentId = user.departmentId;
    }

    const [tours, total] = await Promise.all([
      db.tour.findMany({
        where,
        orderBy: { startDate: "asc" },
        skip,
        take: limit,
        include: { department: { select: { id: true, name: true } } },
      }),
      db.tour.count({ where }),
    ]);

    return NextResponse.json({ tours, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/tours error:", err);
    return NextResponse.json({ error: "Failed to fetch tours" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const code         = typeof body.code         === "string" ? body.code.trim()         : null;
    const name         = typeof body.name         === "string" ? body.name.trim()         : null;
    const description  = typeof body.description  === "string" ? body.description.trim()  : null;
    const departmentId = typeof body.departmentId === "string" ? body.departmentId        : null;
    const startDate    = typeof body.startDate    === "string" ? new Date(body.startDate) : null;
    const endDate      = typeof body.endDate      === "string" ? new Date(body.endDate)   : null;
    const capacity     = typeof body.capacity     === "number" ? body.capacity             : null;
    const tagIds       = Array.isArray(body.tagIds) ? (body.tagIds as string[]) : [];
    const status       = typeof body.status === "string" ? body.status : "ACTIVE";

    if (!code || !name || !departmentId || !startDate || !endDate || capacity === null) {
      return NextResponse.json(
        { error: "code, name, departmentId, startDate, endDate, and capacity are required" },
        { status: 400 },
      );
    }

    if (capacity < 1) {
      return NextResponse.json({ error: "capacity must be at least 1" }, { status: 400 });
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: "startDate and endDate must be valid ISO dates" }, { status: 400 });
    }

    // Verify department
    const dept = await db.department.findFirst({ where: { id: departmentId } });
    if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });

    const tour = await db.tour.create({
      data: {
        tenantId: user.tenantId,
        code,
        name,
        description,
        departmentId,
        startDate,
        endDate,
        capacity,
        tagIds,
        status: status as never,
      },
    });

    return NextResponse.json({ tour }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
      if ("code" in err && (err as Record<string, unknown>).code === "P2002") {
        return NextResponse.json({ error: "Tour code already exists for this tenant" }, { status: 409 });
      }
    }
    console.error("POST /api/tours error:", err);
    return NextResponse.json({ error: "Failed to create tour" }, { status: 500 });
  }
}
