/**
 * POST /api/broadcasts/cron/tick
 *
 * Cron endpoint: processes all SCHEDULED broadcasts whose scheduledAt <= now().
 * Called every minute by an external cron (e.g., Vercel cron, upstash, cron-job.org).
 *
 * Auth: secured by CRON_SECRET header to prevent unauthorized triggering.
 *
 * Returns: { processed: string[], count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { processScheduledBroadcasts } from "@/modules/broadcast/sender";

export async function POST(request: NextRequest) {
  // Validate shared cron secret — prevents unauthorized execution
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const processed = await processScheduledBroadcasts();
    return NextResponse.json({ processed, count: processed.length });
  } catch (error) {
    console.error("[broadcasts/cron/tick] Error:", error);
    return NextResponse.json(
      { error: "Cron tick failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
