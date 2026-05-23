import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import {
  listWidgetConfigs,
  createWidgetConfig,
} from "@/modules/widget/widget.service";
import { logAudit } from "@/modules/audit/audit.service";

/**
 * GET /api/widget-configs
 *
 * Admin: list all WidgetConfigs for the authenticated tenant.
 * Requires "settings:widget" permission.
 */
export async function GET() {
  try {
    const { db } = await requirePermission("settings:widget");
    const configs = await listWidgetConfigs(db);
    return NextResponse.json({ configs });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/widget-configs error:", error);
    return NextResponse.json({ error: "Failed to fetch widget configs" }, { status: 500 });
  }
}

/**
 * POST /api/widget-configs
 *
 * Admin: create a new WidgetConfig for a department.
 * Body: { departmentId, welcomeMessage?, placeholderText?, position?,
 *         buttonIcon?, themeOverride?, offlineMessage?, quickActions?,
 *         businessHours?, autoOpenDelayMs?, maxConcurrentVisitors? }
 */
export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:widget");
    const body = await request.json();

    const {
      departmentId,
      welcomeMessage,
      placeholderText,
      position,
      buttonIcon,
      themeOverride,
      offlineMessage,
      quickActions,
      businessHours,
      autoOpenDelayMs,
      maxConcurrentVisitors,
    } = body;

    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "departmentId is required" }, { status: 400 });
    }

    // Verify department exists within this tenant
    const dept = await db.department.findFirst({ where: { id: departmentId, isActive: true } });
    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const VALID_POSITIONS = ["BOTTOM_RIGHT", "BOTTOM_LEFT"];
    const VALID_ICONS = ["CHAT", "HELP", "CUSTOM"];

    if (position && !VALID_POSITIONS.includes(position)) {
      return NextResponse.json({ error: "Invalid position value" }, { status: 400 });
    }
    if (buttonIcon && !VALID_ICONS.includes(buttonIcon)) {
      return NextResponse.json({ error: "Invalid buttonIcon value" }, { status: 400 });
    }

    const config = await createWidgetConfig(db, {
      departmentId,
      welcomeMessage: welcomeMessage?.trim() || undefined,
      placeholderText: placeholderText?.trim() || undefined,
      position: position || undefined,
      buttonIcon: buttonIcon || undefined,
      themeOverride: themeOverride || undefined,
      offlineMessage: offlineMessage?.trim() || undefined,
      quickActions: quickActions || undefined,
      businessHours: businessHours || undefined,
      autoOpenDelayMs: autoOpenDelayMs !== undefined ? Number(autoOpenDelayMs) : undefined,
      maxConcurrentVisitors: maxConcurrentVisitors !== undefined ? Number(maxConcurrentVisitors) : undefined,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "widget_config.create",
      entityType: "WidgetConfig",
      entityId: config.id,
      newValue: config,
    });

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message.includes("Unique constraint")) {
        return NextResponse.json(
          { error: "A widget config already exists for this department" },
          { status: 409 }
        );
      }
    }
    console.error("POST /api/widget-configs error:", error);
    return NextResponse.json({ error: "Failed to create widget config" }, { status: 500 });
  }
}
