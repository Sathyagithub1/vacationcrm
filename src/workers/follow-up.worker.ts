/**
 * Follow-up Worker
 *
 * Periodically finds PENDING follow-ups where scheduledAt <= now,
 * creates a notification for the assigned user, and marks the follow-up as SENT.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createNotification } from "@/modules/notifications/notification.service";

const QUEUE_NAME = "follow-ups";
const BATCH_SIZE = 50;

async function processDueFollowUps() {
  const now = new Date();

  const dueFollowUps = await prisma.followUp.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
    },
    include: {
      lead: {
        include: {
          customer: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
    take: BATCH_SIZE,
  });

  console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups`);

  for (const followUp of dueFollowUps) {
    try {
      // Create notification for the assigned user
      await createNotification({
        tenantId: followUp.tenantId,
        userId: followUp.assignedTo,
        type: "FOLLOW_UP_DUE",
        title: `Follow-up due: ${followUp.type}`,
        body: `Follow-up for ${followUp.lead.customer.name} (${followUp.lead.department.name}) is now due.`,
        data: {
          followUpId: followUp.id,
          leadId: followUp.leadId,
          type: followUp.type,
        },
      });

      // Mark as SENT
      await prisma.followUp.update({
        where: { id: followUp.id },
        data: { status: "SENT" },
      });

      console.log(`[FollowUp Worker] Processed follow-up ${followUp.id}`);
    } catch (err) {
      console.error(`[FollowUp Worker] Error processing follow-up ${followUp.id}:`, err);
      // Continue with next follow-up -- don't crash on one failure
    }
  }

  return dueFollowUps.length;
}

export function createFollowUpWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[FollowUp Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      return processDueFollowUps();
    },
    {
      connection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[FollowUp Worker] Job ${job.id} completed, processed ${result} follow-ups`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[FollowUp Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[FollowUp Worker] Started");
  return worker;
}

// Export for direct invocation (cron-style)
export { processDueFollowUps };
