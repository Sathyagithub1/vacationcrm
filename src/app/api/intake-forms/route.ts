/**
 * src/app/api/intake-forms/route.ts
 *
 * T35 — IntakeForm list + create.
 *
 * GET  /api/intake-forms  — paginated list (COMPANY_ADMIN / DEPT_MANAGER)
 * POST /api/intake-forms  — create (COMPANY_ADMIN only)
 *
 * All operations are scoped to the authenticated user's tenantId via
 * requireAuth() + tenantPrisma().
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

    // AGENT role cannot access intake form management
    if (user.role === "AGENT" || user.role === "VIEWER") {
      return forbidden();
    }

    const { searchParams } = request.nextUrl;
    const page  = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip  = (page - 1) * limit;
    const status = searchParams.get("status") ?? undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    // DEPT_MANAGER: filter by their department
    if (user.role === "DEPT_MANAGER" && user.departmentId) {
      where.departmentId = user.departmentId;
    }

    const [forms, total] = await Promise.all([
      db.intakeForm.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          department: { select: { id: true, name: true } },
        },
      }),
      db.intakeForm.count({ where }),
    ]);

    return NextResponse.json({
      forms,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/intake-forms error:", err);
    return NextResponse.json({ error: "Failed to fetch intake forms" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const source      = typeof body.source       === "string" ? body.source      : null;
    const externalId  = typeof body.externalId   === "string" ? body.externalId  : null;
    const name        = typeof body.name         === "string" ? body.name        : null;
    const departmentId= typeof body.departmentId === "string" ? body.departmentId: null;
    const fieldMap    = body.fieldMap && typeof body.fieldMap === "object" ? body.fieldMap : {};

    if (!source || !externalId || !name) {
      return NextResponse.json(
        { error: "source, externalId, and name are required" },
        { status: 400 },
      );
    }

    // Verify department belongs to tenant if supplied
    if (departmentId) {
      const dept = await db.department.findFirst({ where: { id: departmentId } });
      if (!dept) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
    }

    const form = await db.intakeForm.create({
      data: {
        tenantId:   user.tenantId,
        source:     source as never,  // Cast: Prisma enum validated at DB level
        externalId,
        name,
        departmentId: departmentId ?? null,
        fieldMap:     fieldMap as never,
        status:       "PENDING_REVIEW",
      },
    });

    return NextResponse.json({ form }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
      // Unique constraint: (tenantId, source, externalId)
      if ("code" in err && (err as NodeJS.ErrnoException & { code: string }).code === "P2002") {
        return NextResponse.json({ error: "IntakeForm with this source and externalId already exists" }, { status: 409 });
      }
    }
    console.error("POST /api/intake-forms error:", err);
    return NextResponse.json({ error: "Failed to create intake form" }, { status: 500 });
  }
}
