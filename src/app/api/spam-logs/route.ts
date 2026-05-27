/**
 * src/app/api/spam-logs/route.ts
 *
 * T40 — SpamLog paginated list.
 *
 * GET /api/spam-logs  — list logs with optional date + channel filters
 *
 * Query params:
 *   channel    — filter by exact channel string
 *   dateFrom   — ISO date (inclusive)
 *   dateTo     — ISO date (inclusive, set to end of day)
 *   page, limit
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    if (user.role === "AGENT" || user.role === "VIEWER") return forbidden();

    const { searchParams } = request.nextUrl;
    const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
    const limit   = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip    = (page - 1) * limit;
    const channel = searchParams.get("channel")  ?? undefined;
    const from    = searchParams.get("dateFrom") ?? undefined;
    const to      = searchParams.get("dateTo")   ?? undefined;

    const where: Record<string, unknown> = {};
    if (channel) where.channel = channel;

    if (from || to) {
      const occurredAt: Record<string, Date> = {};
      if (from) occurredAt.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        occurredAt.lte = end;
      }
      where.occurredAt = occurredAt;
    }

    const [logs, total] = await Promise.all([
      db.spamLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip,
        take: limit,
      }),
      db.spamLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/spam-logs error:", err);
    return NextResponse.json({ error: "Failed to fetch spam logs" }, { status: 500 });
  }
}
