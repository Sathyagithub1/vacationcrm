import jwt from "jsonwebtoken";

const WIDGET_JWT_SECRET = process.env.WIDGET_JWT_SECRET ?? process.env.NEXTAUTH_SECRET ?? "widget-secret-fallback";
const VISITOR_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export interface VisitorTokenPayload {
  tenantId: string;
  visitorId: string;
  /** Standard JWT field — issued-at (epoch seconds) */
  iat?: number;
  /** Standard JWT field — expiry (epoch seconds) */
  exp?: number;
}

/**
 * Create a short-lived JWT (24 h) for an anonymous widget visitor.
 * The token embeds tenantId and visitorId so every subsequent request
 * can be authorised without a session cookie.
 */
export function createVisitorToken(tenantId: string, visitorId: string): string {
  const payload: VisitorTokenPayload = { tenantId, visitorId };
  return jwt.sign(payload, WIDGET_JWT_SECRET, { expiresIn: VISITOR_TOKEN_TTL_SECONDS });
}

/**
 * Verify a visitor JWT and return its payload.
 * Throws if the token is invalid, expired, or tampered with.
 */
export function verifyVisitorToken(token: string): VisitorTokenPayload {
  const decoded = jwt.verify(token, WIDGET_JWT_SECRET) as VisitorTokenPayload;
  if (!decoded.tenantId || !decoded.visitorId) {
    throw new Error("Invalid visitor token payload");
  }
  return decoded;
}

/**
 * Extract and verify the visitor JWT from an Authorization header value.
 * Accepts "Bearer <token>" format.
 * Returns null if header is absent or token verification fails.
 */
export function extractVisitorToken(authHeader: string | null): VisitorTokenPayload | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;

  try {
    return verifyVisitorToken(parts[1]);
  } catch {
    return null;
  }
}
