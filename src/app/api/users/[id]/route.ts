import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_ROLES = ["COMPANY_ADMIN", "DEPT_MANAGER", "AGENT", "VIEWER"];

// GET /api/users/[id] — get user detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requirePermission("users:manage");

    const user = await db.user.findFirst({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        departmentId: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        department: { select: { id: true, name: true, color: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}

// PUT /api/users/[id] — update role/department
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("users:manage");

    const existing = await db.user.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      updateData.role = body.role;
    }

    if (body.departmentId !== undefined) {
      if (body.departmentId) {
        const dept = await db.department.findFirst({ where: { id: body.departmentId } });
        if (!dept) {
          return NextResponse.json({ error: "Department not found" }, { status: 404 });
        }
      }
      updateData.departmentId = body.departmentId || null;
    }

    if (body.name !== undefined && body.name.trim()) {
      updateData.name = body.name.trim();
    }

    if (body.phone !== undefined) {
      updateData.phone = body.phone?.trim() || null;
    }

    const updated = await db.user.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.update",
      entityType: "User",
      entityId: id,
      oldValue: { role: existing.role, departmentId: existing.departmentId },
      newValue: updateData,
    });

    const { passwordHash: _ph, ...safeUser } = updated;
    return NextResponse.json({ user: safeUser });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// PATCH /api/users/[id] — activate/deactivate
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("users:manage");

    const body = await request.json();
    const { action } = body;

    if (action !== "activate" && action !== "deactivate") {
      return NextResponse.json({ error: "Action must be 'activate' or 'deactivate'" }, { status: 400 });
    }

    const existing = await db.user.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent self-deactivation
    if (action === "deactivate" && id === user.id) {
      return NextResponse.json({ error: "You cannot deactivate yourself" }, { status: 400 });
    }

    const isActive = action === "activate";
    const updated = await db.user.update({
      where: { id },
      data: { isActive },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: `user.${action}`,
      entityType: "User",
      entityId: id,
      newValue: { isActive },
    });

    const { passwordHash: _ph, ...safeUser } = updated;
    return NextResponse.json({ user: safeUser });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PATCH /api/users/[id] error:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
