/**
 * GET  /api/analytics/settings — fetch tenant analytics settings
 * PUT  /api/analytics/settings — update tenant analytics settings
 *
 * Settings stored as `analyticsSettings` JSON column on the Tenant row.
 * Requires: settings:analytics permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

interface AnalyticsSettingsPayload {
  autoAssignByMl?: boolean;
  enableAiFollowUp?: boolean;
  minConfidenceThreshold?: number;
}

const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettingsPayload = {
  autoAssignByMl: false,
  enableAiFollowUp: false,
  minConfidenceThreshold: 0.7,
};

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest) {
  try {
    const { user } = await requirePermission("settings:analytics");

    // Use raw query to read the analytics_settings column which was added via
    // ALTER TABLE after the Prisma client was last generated.
    const rows = await prisma.$queryRaw<Array<{ analytics_settings: string | null }>>`
      SELECT analytics_settings FROM tenants WHERE id = ${user.tenantId} LIMIT 1
    `;

    const rawValue = rows[0]?.analytics_settings;
    let stored: AnalyticsSettingsPayload = {};
    if (rawValue) {
      try {
        stored = (typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue) as AnalyticsSettingsPayload;
      } catch {
        stored = {};
      }
    }

    const settings: AnalyticsSettingsPayload = { ...DEFAULT_ANALYTICS_SETTINGS, ...stored };

    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/analytics/settings error:", error);
    return NextResponse.json({ error: "Failed to fetch analytics settings" }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(request: NextRequest) {
  try {
    const { user } = await requirePermission("settings:analytics");

    const body = await request.json() as AnalyticsSettingsPayload & Record<string, unknown>;

    // Only pick the known settings fields — ignore scoringWeights (managed separately)
    const { autoAssignByMl, enableAiFollowUp, minConfidenceThreshold } = body;

    // Fetch current settings to merge
    const rows = await prisma.$queryRaw<Array<{ analytics_settings: string | null }>>`
      SELECT analytics_settings FROM tenants WHERE id = ${user.tenantId} LIMIT 1
    `;
    const rawValue = rows[0]?.analytics_settings;
    let current: AnalyticsSettingsPayload = {};
    if (rawValue) {
      try {
        current = (typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue) as AnalyticsSettingsPayload;
      } catch {
        current = {};
      }
    }

    const updated: AnalyticsSettingsPayload = { ...DEFAULT_ANALYTICS_SETTINGS, ...current };

    if (typeof autoAssignByMl === "boolean") updated.autoAssignByMl = autoAssignByMl;
    if (typeof enableAiFollowUp === "boolean") updated.enableAiFollowUp = enableAiFollowUp;
    if (typeof minConfidenceThreshold === "number" &&
      minConfidenceThreshold >= 0 &&
      minConfidenceThreshold <= 1) {
      updated.minConfidenceThreshold = minConfidenceThreshold;
    }

    const settingsJson = JSON.stringify(updated);
    await prisma.$executeRaw`
      UPDATE tenants SET analytics_settings = ${settingsJson}::jsonb WHERE id = ${user.tenantId}
    `;

    return NextResponse.json({ settings: updated });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/analytics/settings error:", error);
    return NextResponse.json({ error: "Failed to update analytics settings" }, { status: 500 });
  }
}
