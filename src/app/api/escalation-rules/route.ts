/**
 * GET  /api/escalation-rules  — list active escalation rules for tenant
 * POST /api/escalation-rules  — create a new escalation rule
 *
 * Requires: settings:escalation permission (falls back to admin-level check)
 */

import { NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

// Helper cast for new model accessors not yet in generated Prisma client (6b)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

const VALID_RULE_TYPES = [
  "MESSAGE_COUNT_THRESHOLD",
  "DURATION",
  "AI_INTENT",
] as const;

const VALID_ACTIONS = ["ESCALATE", "PARK", "NOTIFY"] as const;

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const { db } = await requirePermission("settings:channels");

    const rules = await anyDb(db).escalationRule.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/escalation-rules error:", error);
    return NextResponse.json({ error: "Failed to fetch escalation rules" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("settings:channels");

    const body = (await request.json()) as Record<string, unknown>;
    const { name, type, config, action, isActive } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!type || !VALID_RULE_TYPES.includes(type as (typeof VALID_RULE_TYPES)[number])) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_RULE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!action || !VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return NextResponse.json({ error: "config must be a JSON object" }, { status: 400 });
    }

    // Type-specific config validation
    if (type === "MESSAGE_COUNT_THRESHOLD") {
      const cfg = config as Record<string, unknown>;
      if (typeof cfg.threshold !== "number" || cfg.threshold < 1) {
        return NextResponse.json(
          { error: "MESSAGE_COUNT_THRESHOLD config requires threshold (number >= 1)" },
          { status: 400 }
        );
      }
      if (typeof cfg.windowHours !== "number" || cfg.windowHours < 1) {
        return NextResponse.json(
          { error: "MESSAGE_COUNT_THRESHOLD config requires windowHours (number >= 1)" },
          { status: 400 }
        );
      }
    } else if (type === "DURATION") {
      const cfg = config as Record<string, unknown>;
      if (typeof cfg.maxHours !== "number" || cfg.maxHours < 1) {
        return NextResponse.json(
          { error: "DURATION config requires maxHours (number >= 1)" },
          { status: 400 }
        );
      }
    }

    const rule = await anyDb(db).escalationRule.create({
      data: {
        tenantId: user.tenantId,
        name: (name as string).trim(),
        type: type as (typeof VALID_RULE_TYPES)[number],
        config: config as object,
        action: action as (typeof VALID_ACTIONS)[number],
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/escalation-rules error:", error);
    return NextResponse.json({ error: "Failed to create escalation rule" }, { status: 500 });
  }
}
