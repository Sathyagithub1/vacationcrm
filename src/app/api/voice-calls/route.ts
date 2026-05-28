/**
 * src/app/api/voice-calls/route.ts
 *
 * Phase 6d — Voice call list endpoint.
 *
 * GET /api/voice-calls
 *   Lists voice calls for the authenticated tenant with optional filters:
 *   status, intent, language, direction, dateFrom, dateTo, customerId,
 *   leadId, page, limit
 *
 * Auth: requireAuth()
 * Tenant scoping: all DB reads go through tenantPrisma (auto-injects tenantId)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
} from "@/modules/auth/tenant.middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── GET /api/voice-calls ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { db } = await requireAuth() as { user: unknown; db: AnyDb };

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const intent = searchParams.get("intent") ?? undefined;
    const language = searchParams.get("language") ?? undefined;
    const direction = searchParams.get("direction") ?? undefined;
    const customerId = searchParams.get("customerId") ?? undefined;
    const leadId = searchParams.get("leadId") ?? undefined;
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (intent) where.intent = intent;
    if (language) where.language = language;
    if (direction) where.direction = direction;
    if (customerId) where.customerId = customerId;
    if (leadId) where.leadId = leadId;
    if (dateFrom || dateTo) {
      where.startedAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [voiceCalls, total] = await Promise.all([
      db.voiceCall.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, mobile: true } },
          lead: { select: { id: true, destination: true } },
          _count: { select: { segments: true } },
        },
      }),
      db.voiceCall.count({ where }),
    ]);

    return NextResponse.json({
      voiceCalls,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/voice-calls error:", err);
    return NextResponse.json({ error: "Failed to fetch voice calls" }, { status: 500 });
  }
}
