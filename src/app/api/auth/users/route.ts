import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";

// GET /api/auth/users — list users in tenant (for dropdowns like assign-to)
export async function GET(request: NextRequest) {
  try {
    const { db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const roles = searchParams.getAll("role");

    const where: Record<string, unknown> = { isActive: true };
    if (roles.length > 0) {
      where.role = { in: roles };
    }

    const users = await db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        departmentId: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
