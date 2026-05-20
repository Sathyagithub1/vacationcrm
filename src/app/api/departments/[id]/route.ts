import { NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/departments/[id] — get department detail
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requireAuth();

    const department = await db.department.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, leads: true, pipelineStages: true },
        },
      },
    });

    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json({ department });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json(
      { error: "Failed to fetch department" },
      { status: 500 }
    );
  }
}

// PUT /api/departments/[id] — update department
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("departments:manage");

    const existing = await db.department.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, icon, color, contactEmail, contactPhone, websiteUrl } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (icon !== undefined) updateData.icon = icon || null;
    if (color !== undefined) updateData.color = color || null;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail?.trim() || null;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone?.trim() || null;
    if (websiteUrl !== undefined) updateData.websiteUrl = websiteUrl?.trim() || null;

    const department = await db.department.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "department.update",
      entityType: "Department",
      entityId: department.id,
      oldValue: existing,
      newValue: department,
    });

    return NextResponse.json({ department });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to update department" },
      { status: 500 }
    );
  }
}

// DELETE /api/departments/[id] — soft delete (set isActive=false)
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user, db } = await requirePermission("departments:manage");

    const existing = await db.department.findUnique({
      where: { id },
      include: { _count: { select: { leads: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    if (existing._count.leads > 0) {
      return NextResponse.json(
        { error: "Cannot deactivate department with active leads. Reassign leads first." },
        { status: 409 }
      );
    }

    const department = await db.department.update({
      where: { id },
      data: { isActive: false },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "department.deactivate",
      entityType: "Department",
      entityId: department.id,
      oldValue: { isActive: true },
      newValue: { isActive: false },
    });

    return NextResponse.json({ department });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to deactivate department" },
      { status: 500 }
    );
  }
}
