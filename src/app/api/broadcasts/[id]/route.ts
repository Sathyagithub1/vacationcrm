import { NextRequest, NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import {
  updateBroadcast,
  initiateSend,
  scheduleBroadcast,
} from "@/modules/broadcasts/broadcast.service";
import { addBroadcastJob } from "@/lib/queue";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"];
const VALID_TARGET_TYPES = ["ALL_CUSTOMERS", "DEPARTMENT", "STAGE", "CUSTOM_FILTER"];

// GET /api/broadcasts/[id] — get broadcast detail with stats
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requirePermission("broadcasts:send");

    const broadcast = await db.broadcast.findFirst({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatarUrl: true } },
        recipients: {
          select: {
            id: true,
            status: true,
            deliveredAt: true,
            errorMessage: true,
            customer: { select: { id: true, name: true, email: true, mobile: true } },
          },
          orderBy: { status: "asc" },
          take: 100,
        },
      },
    });

    if (!broadcast) {
      return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
    }

    // Get aggregate stats
    const stats = await db.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId: id },
      _count: { status: true },
    });

    const recipientStats = {
      pending: 0,
      delivered: 0,
      failed: 0,
    };
    for (const s of stats) {
      const key = s.status.toLowerCase() as keyof typeof recipientStats;
      if (key in recipientStats) {
        recipientStats[key] = s._count.status;
      }
    }

    return NextResponse.json({ broadcast, recipientStats });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/broadcasts/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch broadcast" }, { status: 500 });
  }
}

// PUT /api/broadcasts/[id] — update a draft broadcast
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("broadcasts:send");

    const body = await request.json();
    const { title, content, channel, targetType, targetFilter, scheduledAt } = body;

    // Validate if provided
    if (channel && !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }
    if (targetType && !VALID_TARGET_TYPES.includes(targetType)) {
      return NextResponse.json({ error: "Invalid target type" }, { status: 400 });
    }

    const broadcast = await updateBroadcast(db, id, {
      title,
      content,
      channel,
      targetType,
      targetFilter,
      scheduledAt,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "broadcast.update",
      entityType: "Broadcast",
      entityId: broadcast.id,
      newValue: broadcast,
    });

    return NextResponse.json({ broadcast });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Broadcast not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message === "Can only edit draft broadcasts") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("PUT /api/broadcasts/[id] error:", error);
    return NextResponse.json({ error: "Failed to update broadcast" }, { status: 500 });
  }
}

// PATCH /api/broadcasts/[id] — send or schedule a broadcast
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("broadcasts:send");

    const body = await request.json();
    const { action, scheduledAt } = body;

    if (action === "send") {
      // Initiate send: resolve recipients, create records, queue jobs
      const result = await initiateSend(db, id);

      // Queue background processing
      await addBroadcastJob({ broadcastId: id, tenantId: user.tenantId });

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "broadcast.send",
        entityType: "Broadcast",
        entityId: id,
        newValue: { recipientCount: result.recipientCount },
      });

      return NextResponse.json({
        success: true,
        message: `Broadcast queued for ${result.recipientCount} recipients`,
        recipientCount: result.recipientCount,
      });
    }

    if (action === "schedule") {
      if (!scheduledAt) {
        return NextResponse.json({ error: "scheduledAt is required for scheduling" }, { status: 400 });
      }

      const broadcast = await scheduleBroadcast(db, id, scheduledAt);

      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "broadcast.schedule",
        entityType: "Broadcast",
        entityId: id,
        newValue: { scheduledAt },
      });

      return NextResponse.json({ broadcast });
    }

    return NextResponse.json({ error: "Invalid action. Use 'send' or 'schedule'" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Broadcast not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (
        error.message.includes("No recipients") ||
        error.message.includes("must be in DRAFT") ||
        error.message.includes("Can only schedule")
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("PATCH /api/broadcasts/[id] error:", error);
    return NextResponse.json({ error: "Failed to process broadcast action" }, { status: 500 });
  }
}
