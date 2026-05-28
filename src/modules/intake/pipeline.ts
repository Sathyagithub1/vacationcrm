// src/modules/intake/pipeline.ts
/**
 * runPipeline — core 7-stage intake pipeline.
 *
 * Idempotency: If the same webhookLogId has already been processed (i.e. the
 * IntakeWebhookLog row has processed=true and a leadId set), we short-circuit
 * and return a payload stub carrying the existing leadId.  This prevents
 * double-creation when a caller retries a timed-out request that actually
 * succeeded.
 *
 * Structured error handling: Any unhandled exception from a stage is caught
 * here; the IntakeWebhookLog.errorMessage is updated via the prisma client so
 * the route handler can immediately return a 500 without needing its own
 * try/catch around every stage call.  The route handler's own catch block is
 * still present as a safety net.
 */

import { prisma } from "@/lib/prisma";
import type { IntakePayload, IntakeStages } from "./types";

export async function runPipeline(
  payload: IntakePayload,
  stages: IntakeStages,
): Promise<IntakePayload> {
  // ── Idempotency guard ──────────────────────────────────────────────────────
  // Check if this webhookLogId was already fully processed.  A processed=true
  // row with a non-null leadId means the pipeline ran to completion on a prior
  // invocation — return without re-running any stage.
  const existingLog = await prisma.intakeWebhookLog.findUnique({
    where: { id: payload.webhookLogId },
    select: { processed: true, leadId: true },
  });

  if (existingLog?.processed && existingLog.leadId) {
    // Already succeeded on a prior call — return idempotent stub.
    return { ...payload, leadId: existingLog.leadId };
  }

  // ── Stage execution ────────────────────────────────────────────────────────
  try {
    let p = await stages.spam(payload);
    if (p.spamCheck && !p.spamCheck.passed) return p;

    p = await stages.normalize(p);

    p = await stages.dedup(p);
    if (p.dedupResult?.existingLeadId) return p; // duplicate — REPEAT_INQUIRY activity already appended

    p = await stages.department(p);
    p = await stages.tour(p);
    p = await stages.dispatch(p);   // creates Lead/Conversation, sets p.leadId
    p = await stages.assignment(p); // requires p.leadId — assigns to agent
    return p;
  } catch (err: unknown) {
    // Update the webhook log with the error so the route handler (and
    // operators querying the log table) can see what went wrong.
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.intakeWebhookLog
      .update({
        where: { id: payload.webhookLogId },
        data: { processed: false, errorMessage },
      })
      .catch(() => {
        // Swallow secondary DB errors so the original error propagates cleanly.
      });
    throw err; // re-throw so route handler returns 500
  }
}
