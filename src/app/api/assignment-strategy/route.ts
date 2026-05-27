/**
 * src/app/api/assignment-strategy/route.ts
 *
 * T36 — Assignment strategy GET/PUT.
 *
 * GET /api/assignment-strategy  — returns current strategy (null when unset)
 * PUT /api/assignment-strategy  — upsert strategy with per-type config validation
 *
 * Validation rules per type:
 *   ROUND_ROBIN    — config: {} (no extra fields required)
 *   LOAD_BALANCED  — config: {} (no extra fields required)
 *   SKILL_BASED    — config: { skillWeights?: Record<string,number> }
 *   AI_TIERED      — config: { lowCutoff: number, highCutoff: number,
 *                              tiers?: [string[], string[], string[]] }
 *   NAMED_POOLS    — config: {} (pools managed via /api/assignment-pools)
 *
 * COMPANY_ADMIN or SUPER_ADMIN required for PUT.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

const VALID_TYPES = new Set([
  "ROUND_ROBIN",
  "LOAD_BALANCED",
  "SKILL_BASED",
  "AI_TIERED",
  "NAMED_POOLS",
]);

/** Validate the config object per strategy type. Returns error string or null. */
function validateConfig(type: string, config: Record<string, unknown>): string | null {
  switch (type) {
    case "ROUND_ROBIN":
    case "LOAD_BALANCED":
    case "NAMED_POOLS":
      return null; // no required fields

    case "SKILL_BASED": {
      if (config.skillWeights !== undefined) {
        if (typeof config.skillWeights !== "object" || Array.isArray(config.skillWeights)) {
          return "skillWeights must be a plain object";
        }
        for (const [, v] of Object.entries(config.skillWeights as Record<string, unknown>)) {
          if (typeof v !== "number") return "skillWeights values must be numbers";
        }
      }
      return null;
    }

    case "AI_TIERED": {
      const { lowCutoff, highCutoff } = config;
      if (lowCutoff === undefined || highCutoff === undefined) {
        return "AI_TIERED requires lowCutoff and highCutoff";
      }
      if (typeof lowCutoff !== "number" || typeof highCutoff !== "number") {
        return "lowCutoff and highCutoff must be numbers";
      }
      if (lowCutoff < 0 || lowCutoff > 1 || highCutoff < 0 || highCutoff > 1) {
        return "lowCutoff and highCutoff must be between 0 and 1";
      }
      if (lowCutoff >= highCutoff) {
        return "lowCutoff must be less than highCutoff";
      }
      return null;
    }

    default:
      return null;
  }
}

export async function GET() {
  try {
    const { db } = await requireAuth();

    const strategy = await db.assignmentStrategy.findFirst({});
    return NextResponse.json({ strategy: strategy ?? null });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/assignment-strategy error:", err);
    return NextResponse.json({ error: "Failed to fetch assignment strategy" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const type   = typeof body.type   === "string" ? body.type   : null;
    const config = body.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : {};

    if (!type || !VALID_TYPES.has(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${[...VALID_TYPES].join(", ")}` },
        { status: 400 },
      );
    }

    const configError = validateConfig(type, config);
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 400 });
    }

    const strategy = await db.assignmentStrategy.upsert({
      where:  { tenantId: user.tenantId },
      update: { type: type as never, config },
      create: { tenantId: user.tenantId, type: type as never, config },
    });

    return NextResponse.json({ strategy });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("PUT /api/assignment-strategy error:", err);
    return NextResponse.json({ error: "Failed to update assignment strategy" }, { status: 500 });
  }
}
