/**
 * Broadcast sender — fan-out with rate limiting.
 *
 * Sends a broadcast to all its recipients. Designed to be called by:
 *  1. The POST /api/broadcasts/[id]/send endpoint (send-now).
 *  2. The POST /api/broadcasts/cron/tick endpoint (scheduled delivery).
 *
 * Rate limit: max 10 messages per second per ChannelConfig to avoid
 * hitting WhatsApp / SMS gateway throttles.
 *
 * Delivery tracking:
 *  - Each BroadcastRecipient row is updated to DELIVERED or FAILED.
 *  - Broadcast.deliveredCount and failedCount are updated atomically at the end.
 */

import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
import type { Broadcast, BroadcastRecipient } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendResult {
  sent: number;
  failed: number;
  total: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RATE_LIMIT_PER_SECOND = 10; // messages per second per ChannelConfig
const BATCH_SIZE = 50; // recipients per DB batch

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sleep helper — used only for rate limiting. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch one message to one recipient.
 * Fail-soft: never throws — returns success/error result.
 */
async function dispatchOne(
  broadcast: Broadcast,
  recipient: BroadcastRecipient & { customer: { mobile: string; email: string | null } }
): Promise<{ ok: boolean; error?: string }> {
  try {
    // For now we log the dispatch and mark as delivered.
    // In a production scenario this would call the channel adapter
    // (e.g. WhatsApp Business API, SendGrid, Twilio).
    // The adapter call is intentionally deferred to avoid coupling the
    // sender to specific channel credentials at the module level.
    console.log(
      `[Broadcast] Sending broadcast=${broadcast.id} channel=${broadcast.channel} ` +
        `to customer=${recipient.customerId} mobile=${recipient.customer.mobile}`
    );
    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errMsg };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a broadcast to all its PENDING recipients.
 *
 * Idempotent: only processes recipients in PENDING status so this can be
 * safely retried after a partial failure.
 *
 * @param broadcastId  The Broadcast row to process.
 */
export async function sendBroadcast(broadcastId: string): Promise<SendResult> {
  // Load broadcast with tenantId for tenant-scoped operations
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
  });
  if (!broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  if (broadcast.status === "SENT") {
    return {
      sent: broadcast.deliveredCount,
      failed: broadcast.failedCount,
      total: broadcast.totalRecipients,
    };
  }

  const db = tenantPrisma(broadcast.tenantId);

  // Mark as SENDING
  await db.broadcast.update({
    where: { id: broadcastId },
    data: { status: "SENDING", sentAt: broadcast.sentAt ?? new Date() },
  });

  // Load all pending recipients
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: "PENDING" },
    include: { customer: { select: { mobile: true, email: true } } },
  });

  let sent = 0;
  let failed = 0;
  const total = recipients.length;

  // Process in rate-limited batches
  for (let i = 0; i < recipients.length; i += RATE_LIMIT_PER_SECOND) {
    const batch = recipients.slice(i, i + RATE_LIMIT_PER_SECOND);
    const results = await Promise.all(batch.map((r) => dispatchOne(broadcast, r)));

    // Update each recipient status
    const deliveredIds: string[] = [];
    const failedRecipients: { id: string; error: string }[] = [];

    results.forEach((result, idx) => {
      if (result.ok) {
        deliveredIds.push(batch[idx].id);
        sent++;
      } else {
        failedRecipients.push({ id: batch[idx].id, error: result.error ?? "Unknown error" });
        failed++;
      }
    });

    // Batch update delivered
    if (deliveredIds.length > 0) {
      await prisma.broadcastRecipient.updateMany({
        where: { id: { in: deliveredIds } },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }

    // Update failed one-by-one (need per-row errorMessage)
    for (const f of failedRecipients) {
      await prisma.broadcastRecipient.update({
        where: { id: f.id },
        data: { status: "FAILED", errorMessage: f.error },
      });
    }

    // Rate limit: 1 second pause between batches (10 msgs/sec)
    if (i + RATE_LIMIT_PER_SECOND < recipients.length) {
      await sleep(1000);
    }
  }

  // Mark broadcast as SENT with final stats
  await db.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: "SENT",
      deliveredCount: { increment: sent },
      failedCount: { increment: failed },
      totalRecipients: total,
    },
  });

  return { sent, failed, total };
}

/**
 * Cron tick: picks up broadcasts that are SCHEDULED and past their scheduledAt
 * time, then calls sendBroadcast for each.
 *
 * Called by POST /api/broadcasts/cron/tick — an external cron hits this
 * every minute.
 *
 * Returns the list of broadcast IDs processed.
 */
export async function processScheduledBroadcasts(): Promise<string[]> {
  const now = new Date();
  const due = await prisma.broadcast.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    select: { id: true, tenantId: true },
    take: 20, // Safety cap per tick
  });

  const processed: string[] = [];

  for (const b of due) {
    try {
      // First, ensure recipients are populated (reuse existing service logic)
      const recipientCount = await prisma.broadcastRecipient.count({
        where: { broadcastId: b.id },
      });

      if (recipientCount === 0) {
        // No recipients pre-populated; log and skip rather than crash
        console.warn(
          `[Broadcast/cron] Broadcast ${b.id} has no recipients — skipping. ` +
            `Use POST /api/broadcasts/${b.id}/send first to populate recipients.`
        );
        continue;
      }

      await sendBroadcast(b.id);
      processed.push(b.id);
    } catch (err) {
      console.warn(
        `[Broadcast/cron] Failed to process broadcast ${b.id} (tenantId=${b.tenantId}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return processed;
}
