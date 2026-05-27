/**
 * src/app/api/spam-rules/route.ts
 *
 * T40 — SpamRule list + create.
 *
 * GET  /api/spam-rules  — list active rules for tenant
 * POST /api/spam-rules  — create rule; type-specific validation
 *
 * Type-specific validation:
 *   BLACKLIST   — identifier required (phone/email/handle)
 *   RATE_LIMIT  — threshold (int ≥ 1), windowSeconds (int ≥ 1), blockSeconds (int ≥ 1)
 *   PATTERN     — identifier treated as regex; must compile without error
 *   AI          — aiThreshold (float 0–1)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

function validateRule(type: string, body: Record<string, unknown>): string | null {
  switch (type) {
    case "BLACKLIST":
      return typeof body.identifier === "string" && body.identifier.trim()
        ? null
        : "identifier is required for BLACKLIST rules";

    case "RATE_LIMIT": {
      const { threshold, windowSeconds, blockSeconds } = body;
      if (typeof threshold !== "number" || threshold < 1)
        return "threshold must be an integer ≥ 1";
      if (typeof windowSeconds !== "number" || windowSeconds < 1)
        return "windowSeconds must be an integer ≥ 1";
      if (typeof blockSeconds !== "number" || blockSeconds < 1)
        return "blockSeconds must be an integer ≥ 1";
      return null;
    }

    case "PATTERN": {
      const ident = typeof body.identifier === "string" ? body.identifier : "";
      if (!ident) return "identifier (regex pattern) is required for PATTERN rules";
      try {
        new RegExp(ident);
        return null;
      } catch {
        return `identifier is not a valid regular expression: ${ident}`;
      }
    }

    case "AI": {
      const { aiThreshold } = body;
      if (typeof aiThreshold !== "number" || aiThreshold < 0 || aiThreshold > 1)
        return "aiThreshold must be a number between 0 and 1";
      return null;
    }

    default:
      return `Unknown rule type: ${type}`;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    if (user.role === "AGENT" || user.role === "VIEWER") return forbidden();

    const { searchParams } = request.nextUrl;
    const type      = searchParams.get("type")      ?? undefined;
    const isActive  = searchParams.get("isActive");

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (isActive !== null) where.isActive = isActive !== "false";

    const rules = await db.spamRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch spam rules" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const type   = typeof body.type === "string" ? body.type.toUpperCase() : null;
    if (!type) {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }

    const validError = validateRule(type, body);
    if (validError) {
      return NextResponse.json({ error: validError }, { status: 400 });
    }

    const identifier     = typeof body.identifier     === "string" ? body.identifier     : `_auto_${Date.now()}`;
    const reason         = typeof body.reason         === "string" ? body.reason         : null;
    const channels       = Array.isArray(body.channels)       ? (body.channels as string[])       : [];
    const departmentIds  = Array.isArray(body.departmentIds)  ? (body.departmentIds as string[])  : [];
    const expiresAt      = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;

    const rule = await db.spamRule.create({
      data: {
        tenantId:      user.tenantId,
        type:          type as never,
        identifier,
        reason,
        channels,
        departmentIds,
        expiresAt,
        threshold:     typeof body.threshold     === "number" ? body.threshold     : null,
        windowSeconds: typeof body.windowSeconds === "number" ? body.windowSeconds : null,
        blockSeconds:  typeof body.blockSeconds  === "number" ? body.blockSeconds  : null,
        aiThreshold:   typeof body.aiThreshold   === "number" ? body.aiThreshold   : null,
        createdById:   user.id,
        isActive:      true,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("POST /api/spam-rules error:", err);
    return NextResponse.json({ error: "Failed to create spam rule" }, { status: 500 });
  }
}
