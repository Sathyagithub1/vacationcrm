import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { updateWidgetConfig } from "@/modules/widget/widget.service";
import { logAudit } from "@/modules/audit/audit.service";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PUT /api/widget-configs/[id]
 *
 * Admin: update an existing WidgetConfig.
 * Requires "settings:widget" permission.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("settings:widget");
    const body = await request.json();

    const {
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
      isActive,
    } = body;

    const VALID_POSITIONS = ["BOTTOM_RIGHT", "BOTTOM_LEFT"];
    const VALID_ICONS = ["CHAT", "HELP", "CUSTOM"];

    if (position !== undefined && !VALID_POSITIONS.includes(position)) {
      return NextResponse.json({ error: "Invalid position value" }, { status: 400 });
    }
    if (buttonIcon !== undefined && !VALID_ICONS.includes(buttonIcon)) {
      return NextResponse.json({ error: "Invalid buttonIcon value" }, { status: 400 });
    }

    const config = await updateWidgetConfig(db, id, {
      welcomeMessage: welcomeMessage !== undefined ? welcomeMessage?.trim() : undefined,
      placeholderText: placeholderText !== undefined ? placeholderText?.trim() : undefined,
      position: position || undefined,
      buttonIcon: buttonIcon || undefined,
      themeOverride: themeOverride !== undefined ? themeOverride : undefined,
      offlineMessage: offlineMessage !== undefined ? offlineMessage?.trim() : undefined,
      quickActions: quickActions !== undefined ? quickActions : undefined,
      businessHours: businessHours !== undefined ? businessHours : undefined,
      autoOpenDelayMs: autoOpenDelayMs !== undefined ? Number(autoOpenDelayMs) : undefined,
      maxConcurrentVisitors: maxConcurrentVisitors !== undefined ? Number(maxConcurrentVisitors) : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "widget_config.update",
      entityType: "WidgetConfig",
      entityId: config.id,
      newValue: config,
    });

    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Widget config not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PUT /api/widget-configs/[id] error:", error);
    return NextResponse.json({ error: "Failed to update widget config" }, { status: 500 });
  }
}

/**
 * DELETE /api/widget-configs/[id]
 *
 * Admin: delete a WidgetConfig.
 * Requires "settings:widget" permission.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("settings:widget");

    const existing = await db.widgetConfig.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Widget config not found" }, { status: 404 });
    }

    await db.widgetConfig.delete({ where: { id } });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "widget_config.delete",
      entityType: "WidgetConfig",
      entityId: id,
      oldValue: existing,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("DELETE /api/widget-configs/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete widget config" }, { status: 500 });
  }
}
