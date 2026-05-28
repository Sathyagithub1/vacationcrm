/**
 * GET  /api/broadcasts           — list broadcasts (with optional status filter)
 * POST /api/broadcasts           — create a draft broadcast (tag-targeted or classic)
 *
 * Phase 6b change: POST now accepts `targetTagIds` (string[]) for tag-based
 * audience segmentation and `targetScope` ("CUSTOMER" | "LEAD").
 *
 * Requires: broadcasts:send permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { createBroadcast } from "@/modules/broadcasts/broadcast.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"];
const VALID_TARGET_TYPES = ["ALL_CUSTOMERS", "DEPARTMENT", "STAGE", "CUSTOM_FILTER", "TAG"];

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const { db } = await requireAuth();
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

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("broadcasts:send");

    const body = (await request.json()) as Record<string, unknown>;
    const { title, content, channel, targetType, targetFilter, scheduledAt, targetTagIds } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (!channel || !VALID_CHANNELS.includes(channel as string)) {
      return NextResponse.json(
        { error: `Valid channel is required: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!targetType || !VALID_TARGET_TYPES.includes(targetType as string)) {
      return NextResponse.json(
        { error: `Valid targetType is required: ${VALID_TARGET_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate targetTagIds when targetType is TAG
    const tagIds =
      Array.isArray(targetTagIds) ? (targetTagIds as string[]).filter((t) => typeof t === "string") : [];

    if (targetType === "TAG" && tagIds.length === 0) {
      return NextResponse.json(
        { error: "targetTagIds (non-empty string[]) is required when targetType is TAG" },
        { status: 400 }
      );
    }

    const broadcast = await createBroadcast({
      tenantId: user.tenantId,
      createdBy: user.id,
      title: (title as string).trim(),
      content: (content as string).trim(),
      channel: channel as "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP",
      targetType: targetType as "ALL_CUSTOMERS" | "DEPARTMENT" | "STAGE" | "CUSTOM_FILTER",
      targetFilter: (targetFilter as Record<string, unknown>) || null,
      scheduledAt: (scheduledAt as string) || null,
    });

    // Update targetTagIds separately if provided (Prisma doesn't handle array fields in create well via the service)
    if (tagIds.length > 0) {
      const { prisma } = await import("@/lib/prisma");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.broadcast as any).update({
        where: { id: broadcast.id },
        data: { targetTagIds: tagIds },
      });
    }

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "broadcast.create",
      entityType: "Broadcast",
      entityId: broadcast.id,
      newValue: { ...broadcast, targetTagIds: tagIds },
    });

    return NextResponse.json({ broadcast: { ...broadcast, targetTagIds: tagIds } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/broadcasts error:", error);
    return NextResponse.json({ error: "Failed to create broadcast" }, { status: 500 });
  }
}
