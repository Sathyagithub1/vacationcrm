import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

// GET /api/settings/notifications — get tenant notification settings
export async function GET() {
  try {
    const { user } = await requirePermission("settings:notifications");

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { notificationSettings: true },
    });

    return NextResponse.json({
      settings: tenant?.notificationSettings || {},
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/settings/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

// PUT /api/settings/notifications — update tenant notification settings
export async function PUT(request: Request) {
  try {
    const { user } = await requirePermission("settings:notifications");

    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Settings object required" }, { status: 400 });
    }

    await prisma.tenant.update({
      where: { id: user.tenantId },
      data: { notificationSettings: settings },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/settings/notifications error:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
