import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";
import { generateToken } from "@/lib/utils";
import { sendEmail } from "@/modules/notifications/channels/email.channel";

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

    const inviteUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/accept-invite?token=${token}`;

    // Look up tenant product name for the email
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { productName: true },
    });
    const productName = tenant?.productName || "CRM";

    await sendEmail({
      to: normalizedEmail,
      subject: `You've been invited to ${productName}`,
      body: `You have been invited to join ${productName} as ${role.toLowerCase()}.\n\nClick the link below to accept your invitation and create your account:\n\n${inviteUrl}\n\nThis invitation expires in 7 days.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">You're invited!</h2>
          <p style="color: #555;">You have been invited to join <strong>${productName}</strong> as <strong>${role.toLowerCase()}</strong>.</p>
          <p style="margin: 24px 0;">
            <a href="${inviteUrl}" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
              Accept Invitation
            </a>
          </p>
          <p style="color: #888; font-size: 13px;">This invitation expires in 7 days.</p>
        </div>
      `,
    });

    console.log(`[INVITATION] Email sent to ${normalizedEmail}, URL: ${inviteUrl}`);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "invitation.create",
      entityType: "Invitation",
      entityId: invitation.id,
      newValue: { email: normalizedEmail, role, departmentId },
    });

    // Do not return token/URL in the response — it is sent via email only
    const { token: _token, ...safeInvitation } = invitation;
    return NextResponse.json({ invitation: safeInvitation }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/invitations error:", error);
    return NextResponse.json({ error: "Failed to send invitation" }, { status: 500 });
  }
}
