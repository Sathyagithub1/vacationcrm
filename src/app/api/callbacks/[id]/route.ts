import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

// PUT /api/callbacks/[id] — update callback fields
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("callbacks:create");

    const existing = await db.callback.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Callback not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.preferredTime) updateData.preferredTime = new Date(body.preferredTime);
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo || null;
    if (body.notes !== undefined) updateData.notes = body.notes?.trim() || null;

    const callback = await db.callback.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "callback.update",
      entityType: "Callback",
      entityId: id,
      oldValue: existing,
      newValue: callback,
    });

    return NextResponse.json({ callback });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/callbacks/[id] error:", error);
    return NextResponse.json({ error: "Failed to update callback" }, { status: 500 });
  }
}

// PATCH /api/callbacks/[id] — actions: complete, missed
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    const { user, db } = await requirePermission("callbacks:create");

    const existing = await db.callback.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Callback not found" }, { status: 404 });
    }

    if (existing.status !== "SCHEDULED") {
      return NextResponse.json(
        { error: `Cannot ${action} a callback that is already ${existing.status.toLowerCase()}` },
        { status: 400 }
      );
    }

    if (action === "complete") {
      const callback = await db.callback.update({
        where: { id },
        data: { status: "COMPLETED" },
      });

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "callback.complete",
        entityType: "Callback",
        entityId: id,
        newValue: { status: "COMPLETED" },
      });

      return NextResponse.json({ callback });
    }

    if (action === "missed") {
      const callback = await db.callback.update({
        where: { id },
        data: { status: "MISSED" },
      });

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "callback.missed",
        entityType: "Callback",
        entityId: id,
        newValue: { status: "MISSED" },
      });

      return NextResponse.json({ callback });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PATCH /api/callbacks/[id] error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
