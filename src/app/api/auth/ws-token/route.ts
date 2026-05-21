import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getSessionUser, unauthorized } from "@/modules/auth/tenant.middleware";

/**
 * GET /api/auth/ws-token
 * Generate a short-lived JWT for WebSocket authentication.
 * The WS server verifies this token on handshake.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        departmentId: user.departmentId,
      },
      secret,
      { expiresIn: "1h" }
    );

    return NextResponse.json({ token });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}
