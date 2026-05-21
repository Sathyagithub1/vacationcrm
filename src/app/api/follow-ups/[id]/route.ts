import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { markComplete, snoozeFollowUp, reassignFollowUp, cancelFollowUp } from "@/modules/follow-ups/follow-up.service";
import { logAudit } from "@/modules/audit/audit.service";

// PUT /api/follow-ups/[id] — update follow-up fields (type, scheduledAt, messageTemplate)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("follow-ups:create");

    const existing = await db.followUp.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.type) updateData.type = body.type;
    if (body.scheduledAt) updateData.scheduledAt = new Date(body.scheduledAt);
    if (body.messageTemplate !== undefined) updateData.messageTemplate = body.messageTemplate || null;

    const followUp = await db.followUp.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "follow_up.update",
      entityType: "FollowUp",
      entityId: id,
      oldValue: existing,
      newValue: followUp,
    });

    return NextResponse.json({ followUp });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/follow-ups/[id] error:", error);
    return NextResponse.json({ error: "Failed to update follow-up" }, { status: 500 });
  }
}

// PATCH /api/follow-ups/[id] — actions: complete, snooze, reassign, cancel
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

    if (action === "complete") {
      const { user, db } = await requirePermission("follow-ups:create");
      const followUp = await markComplete(db, id);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "follow_up.complete",
        entityType: "FollowUp",
        entityId: id,
        newValue: { status: "COMPLETED" },
      });

      return NextResponse.json({ followUp });
    }

    if (action === "snooze") {
      const { user, db } = await requirePermission("follow-ups:create");
      const { scheduledAt } = body;
      if (!scheduledAt) {
        return NextResponse.json({ error: "New scheduled date is required" }, { status: 400 });
      }

      const followUp = await snoozeFollowUp(db, id, scheduledAt);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "follow_up.snooze",
        entityType: "FollowUp",
        entityId: id,
        newValue: { scheduledAt },
      });

      return NextResponse.json({ followUp });
    }

    if (action === "reassign") {
      const { user, db } = await requirePermission("follow-ups:create");
      const { assignedTo } = body;
      if (!assignedTo || typeof assignedTo !== "string") {
        return NextResponse.json({ error: "New assignee is required" }, { status: 400 });
      }

      const followUp = await reassignFollowUp(db, id, assignedTo);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "follow_up.reassign",
        entityType: "FollowUp",
        entityId: id,
        newValue: { assignedTo },
      });

      return NextResponse.json({ followUp });
    }

    if (action === "cancel") {
      const { user, db } = await requirePermission("follow-ups:create");
      const followUp = await cancelFollowUp(db, id);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "follow_up.cancel",
        entityType: "FollowUp",
        entityId: id,
        newValue: { status: "CANCELLED" },
      });

      return NextResponse.json({ followUp });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Follow-up not found" || error.message === "Assignee not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message.includes("Already") || error.message.includes("Cannot")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("PATCH /api/follow-ups/[id] error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
