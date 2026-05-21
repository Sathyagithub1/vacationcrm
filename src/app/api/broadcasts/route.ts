import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { createBroadcast } from "@/modules/broadcasts/broadcast.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"];
const VALID_TARGET_TYPES = ["ALL_CUSTOMERS", "DEPARTMENT", "STAGE", "CUSTOM_FILTER"];

// GET /api/broadcasts — list broadcasts
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;
    const status = searchParams.get("status") || "";

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [broadcasts, total] = await Promise.all([
      db.broadcast.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          creator: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      db.broadcast.count({ where }),
    ]);

    return NextResponse.json({
      broadcasts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/broadcasts error:", error);
    return NextResponse.json({ error: "Failed to fetch broadcasts" }, { status: 500 });
  }
}

// POST /api/broadcasts — create a draft broadcast
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("broadcasts:send");

    const body = await request.json();
    const { title, content, channel, targetType, targetFilter, scheduledAt } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (!channel || !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "Valid channel is required (EMAIL, SMS, WHATSAPP, IN_APP)" }, { status: 400 });
    }
    if (!targetType || !VALID_TARGET_TYPES.includes(targetType)) {
      return NextResponse.json({ error: "Valid target type is required" }, { status: 400 });
    }

    const broadcast = await createBroadcast({
      tenantId: user.tenantId,
      createdBy: user.id,
      title: title.trim(),
      content: content.trim(),
      channel,
      targetType,
      targetFilter: targetFilter || null,
      scheduledAt: scheduledAt || null,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "broadcast.create",
      entityType: "Broadcast",
      entityId: broadcast.id,
      newValue: broadcast,
    });

    return NextResponse.json({ broadcast }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/broadcasts error:", error);
    return NextResponse.json({ error: "Failed to create broadcast" }, { status: 500 });
  }
}
