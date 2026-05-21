import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/widgets/:id — update widget
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user, db } = await requireAuth();
    const { id } = await context.params;
    const body = await request.json();

    const existing = await db.dashboardWidget.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    const { title, dataSource, filters, size, position, refreshInterval, config, widgetType } = body;

    const widget = await db.dashboardWidget.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(dataSource !== undefined && { dataSource }),
        ...(widgetType !== undefined && { widgetType }),
        ...(filters !== undefined && { filters }),
        ...(size !== undefined && { size }),
        ...(position !== undefined && { position }),
        ...(refreshInterval !== undefined && { refreshInterval }),
        ...(config !== undefined && { config }),
      },
    });

    return NextResponse.json({ widget });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/widgets/:id
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { user, db } = await requireAuth();
    const { id } = await context.params;

    const existing = await db.dashboardWidget.findFirst({
      where: { id, userId: user.id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    await db.dashboardWidget.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
