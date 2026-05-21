import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import {
  listNotifications,
  markNotificationsRead,
  getUnreadCount,
} from "@/modules/notifications/notification.service";

// GET /api/notifications — list notifications for current user
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const unreadOnly = searchParams.get("unread") === "true";
    const countOnly = searchParams.get("countOnly") === "true";

    if (countOnly) {
      const count = await getUnreadCount(db, user.id);
      return NextResponse.json({ unreadCount: count });
    }

    const result = await listNotifications(db, user.id, { page, limit, unreadOnly });
    const unreadCount = await getUnreadCount(db, user.id);

    return NextResponse.json({
      ...result,
      unreadCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(request: Request) {
  try {
    const { user, db } = await requireAuth();
    const body = await request.json();
    const { notificationIds } = body; // optional: array of IDs. If omitted, marks all as read.

    if (notificationIds && !Array.isArray(notificationIds)) {
      return NextResponse.json({ error: "notificationIds must be an array" }, { status: 400 });
    }

    await markNotificationsRead(db, user.id, notificationIds || undefined);
    const unreadCount = await getUnreadCount(db, user.id);

    return NextResponse.json({ success: true, unreadCount });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("PATCH /api/notifications error:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
