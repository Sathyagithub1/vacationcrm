import * as jwt from "jsonwebtoken";
import type { Socket } from "socket.io";

export interface WsUser {
  userId: string;
  tenantId: string;
  departmentId: string | null;
  role: string;
  email: string;
  name: string;
}

/**
 * Validate JWT from socket handshake, extract user info.
 * NextAuth JWTs are signed with NEXTAUTH_SECRET using HS256.
 */
export function authenticateSocket(socket: Socket): WsUser {
  const token = socket.handshake.query.token as string | undefined;

  if (!token) {
    throw new Error("No authentication token provided");
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET not configured");
  }

  try {
    // NextAuth encodes JWT with jose — but the token in handshake is our own
    // custom token generated at login. We verify with the same secret.
    const decoded = jwt.verify(token, secret) as Record<string, unknown>;

    const userId = (decoded.id || decoded.sub) as string | undefined;
    const tenantId = decoded.tenantId as string | undefined;
    const role = decoded.role as string | undefined;

    if (!userId || !tenantId || !role) {
      throw new Error("Invalid token payload — missing userId, tenantId, or role");
    }

    return {
      userId,
      tenantId,
      departmentId: (decoded.departmentId as string) || null,
      role,
      email: (decoded.email as string) || "",
      name: (decoded.name as string) || "",
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error("Token expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid token");
    }
    throw err;
  }
}
