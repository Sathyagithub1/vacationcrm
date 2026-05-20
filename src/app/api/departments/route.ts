import { NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /api/departments — list all departments for the tenant
export async function GET() {
  try {
    const { db } = await requireAuth();

    const departments = await db.department.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: { users: true, leads: true },
        },
      },
    });

    return NextResponse.json({ departments });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json(
      { error: "Failed to fetch departments" },
      { status: 500 }
    );
  }
}

// POST /api/departments — create a new department
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("departments:manage");

    const body = await request.json();
    const { name, description, icon, color, contactEmail, contactPhone, websiteUrl } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const slug = slugify(name.trim());

    // Check for duplicate slug
    const existing = await db.department.findFirst({
      where: { slug },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A department with this name already exists" },
        { status: 409 }
      );
    }

    const department = await (db.department.create as Function)({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        icon: icon || null,
        color: color || null,
        contactEmail: contactEmail?.trim() || null,
        contactPhone: contactPhone?.trim() || null,
        websiteUrl: websiteUrl?.trim() || null,
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "department.create",
      entityType: "Department",
      entityId: department.id,
      newValue: department,
    });

    return NextResponse.json({ department }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json(
      { error: "Failed to create department" },
      { status: 500 }
    );
  }
}
