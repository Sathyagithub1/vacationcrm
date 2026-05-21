import { NextRequest, NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";
import bcrypt from "bcryptjs";

const VALID_ROLES = ["COMPANY_ADMIN", "DEPT_MANAGER", "AGENT", "VIEWER"];

// GET /api/users — list all users for the tenant
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("users:manage");
    const { searchParams } = request.nextUrl;

    const q = searchParams.get("q")?.trim() || "";
    const role = searchParams.get("role") || "";
    const departmentId = searchParams.get("departmentId") || "";
    const isActive = searchParams.get("isActive") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    if (role && VALID_ROLES.includes(role)) where.role = role;
    if (departmentId) where.departmentId = departmentId;
    if (isActive === "true") where.isActive = true;
    if (isActive === "false") where.isActive = false;

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: limit,
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
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/users error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST /api/users — create a user directly (without invitation)
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("users:manage");

    const body = await request.json();
    const { email, name, password, role, departmentId, phone } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Valid role is required" }, { status: 400 });
    }

    // Check if email already exists in tenant
    const existing = await db.user.findFirst({
      where: { email: email.toLowerCase().trim() },
    });
    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    // Verify department if provided
    if (departmentId) {
      const dept = await db.department.findFirst({ where: { id: departmentId } });
      if (!dept) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const newUser = await (db.user.create as Function)({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        role,
        departmentId: departmentId || null,
        phone: phone?.trim() || null,
        isActive: true,
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.create",
      entityType: "User",
      entityId: newUser.id,
      newValue: { email: newUser.email, name: newUser.name, role: newUser.role },
    });

    // Return user without password hash
    const { passwordHash: _ph, ...safeUser } = newUser;
    return NextResponse.json({ user: safeUser }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/users error:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
