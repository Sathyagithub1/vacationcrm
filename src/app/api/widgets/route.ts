import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";

// GET /api/widgets — list user's widgets
export async function GET() {
  try {
    const { user, db } = await requireAuth();

    const widgets = await db.dashboardWidget.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ widgets });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/widgets — create widget
export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const body = await request.json();

    const { widgetType, title, dataSource, filters, size, position, refreshInterval, config } = body;

    if (!widgetType || !title || !dataSource) {
      return NextResponse.json(
        { error: "widgetType, title, and dataSource are required" },
        { status: 400 }
      );
    }

    const widget = await (db.dashboardWidget.create as any)({
      data: {
        userId: user.id,
        widgetType,
        title,
        dataSource,
        filters: filters || undefined,
        size: size || "SMALL",
        position: position || undefined,
        refreshInterval: refreshInterval || 300,
        config: config || undefined,
      },
    });

    return NextResponse.json({ widget }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
