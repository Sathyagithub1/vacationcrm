/**
 * src/app/api/voice-calls/[id]/route.ts
 *
 * Phase 6d — Voice call detail endpoint.
 *
 * GET /api/voice-calls/:id
 *   Returns a single VoiceCall with all its segments.
 *   Tenant-scoped: returns 404 if the call belongs to a different tenant.
 *
 * Auth: requireAuth()
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
} from "@/modules/auth/tenant.middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type RouteContext = { params: Promise<{ id: string }> };

// ── GET /api/voice-calls/[id] ─────────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { db } = await requireAuth() as { user: unknown; db: AnyDb };

    const voiceCall = await db.voiceCall.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, mobile: true } },
        lead: { select: { id: true, destination: true, travelDate: true } },
        conversation: { select: { id: true, status: true, channel: true } },
        segments: {
          orderBy: { startMs: "asc" },
          select: {
            id: true,
            speaker: true,
            content: true,
            audioUrl: true,
            startMs: true,
            endMs: true,
            createdAt: true,
          },
        },
      },
    });

    if (!voiceCall) {
      return NextResponse.json({ error: "Voice call not found" }, { status: 404 });
    }

    return NextResponse.json(voiceCall);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/voice-calls/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch voice call" }, { status: 500 });
  }
}
