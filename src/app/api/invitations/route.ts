import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";
import { generateToken } from "@/lib/utils";

const VALID_ROLES = ["COMPANY_ADMIN", "DEPT_MANAGER", "AGENT", "VIEWER"];

// GET /api/invitations — list pending invitations
export async function GET() {
  try {
    const { db } = await requirePermission("users:manage");

    const invitations = await db.invitation.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        inviter: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ invitations });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/invitations error:", error);
    return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
  }
}

// POST /api/invitations — send an invitation
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("users:manage");

    const body = await request.json();
    const { email, role, departmentId } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Valid role is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.user.findFirst({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    // Check if there's already a pending invitation
    const existingInvite = await db.invitation.findFirst({
      where: { email: normalizedEmail, acceptedAt: null },
    });
    if (existingInvite) {
      return NextResponse.json({ error: "An invitation is already pending for this email" }, { status: 409 });
    }

    // Verify department if provided
    if (departmentId) {
      const dept = await db.department.findFirst({ where: { id: departmentId } });
      if (!dept) {
        return NextResponse.json({ error: "Department not found" }, { status: 404 });
      }
    }

    const token = generateToken(48);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    const invitation = await (db.invitation.create as Function)({
      data: {
        email: normalizedEmail,
        role,
        departmentId: departmentId || null,
        invitedBy: user.id,
        token,
        expiresAt,
      },
    });

    // Log the invitation URL to console (Task 17 will wire actual email sending)
    const inviteUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/auth/accept-invite?token=${token}`;
    console.log(`[INVITATION] Email: ${normalizedEmail}, URL: ${inviteUrl}`);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "invitation.create",
      entityType: "Invitation",
      entityId: invitation.id,
      newValue: { email: normalizedEmail, role, departmentId },
    });

    return NextResponse.json({
      invitation,
      inviteUrl, // Return for dev/testing, remove in production
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/invitations error:", error);
    return NextResponse.json({ error: "Failed to send invitation" }, { status: 500 });
  }
}
