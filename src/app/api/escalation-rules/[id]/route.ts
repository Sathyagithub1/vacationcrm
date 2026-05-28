/**
 * GET    /api/escalation-rules/[id]  — get single rule
 * PATCH  /api/escalation-rules/[id]  — update rule (name, config, action, isActive)
 * DELETE /api/escalation-rules/[id]  — hard delete
 *
 * Requires: settings:channels permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

const VALID_RULE_TYPES = ["MESSAGE_COUNT_THRESHOLD", "DURATION", "AI_INTENT"] as const;
const VALID_ACTIONS = ["ESCALATE", "PARK", "NOTIFY"] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requirePermission("settings:channels");

    const rule = await anyDb(db).escalationRule.findFirst({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json({ error: "Failed to fetch rule" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requirePermission("settings:channels");

    const existing = await anyDb(db).escalationRule.findFirst({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const { name, type, config, action, isActive } = body;

    const updateData: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) updateData.name = name.trim();
    if (type && VALID_RULE_TYPES.includes(type as (typeof VALID_RULE_TYPES)[number])) {
      updateData.type = type;
    }
    if (config && typeof config === "object" && !Array.isArray(config)) {
      updateData.config = config;
    }
    if (action && VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      updateData.action = action;
    }
    if (typeof isActive === "boolean") updateData.isActive = isActive;

    const rule = await anyDb(db).escalationRule.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requirePermission("settings:channels");

    const existing = await anyDb(db).escalationRule.findFirst({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await anyDb(db).escalationRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
