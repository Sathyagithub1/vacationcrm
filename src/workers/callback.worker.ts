/**
 * Callback Worker
 *
 * Finds upcoming callbacks (next 30 minutes) that haven't been reminded yet,
 * and sends reminder notifications to assigned agents.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createNotification } from "@/modules/notifications/notification.service";

const QUEUE_NAME = "callbacks";
const REMINDER_WINDOW_MINUTES = 30;

async function processUpcomingCallbacks() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

  // Find SCHEDULED callbacks in the next 30 minutes with an assigned agent
  const callbacks = await prisma.callback.findMany({
    where: {
      status: "SCHEDULED",
      assignedTo: { not: null },
      preferredTime: {
        gte: now,
        lte: windowEnd,
      },
    },
    include: {
      lead: {
        include: {
          customer: { select: { name: true, mobile: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  console.log(`[Callback Worker] Found ${callbacks.length} upcoming callbacks`);

  let reminded = 0;

  for (const callback of callbacks) {
    try {
      if (!callback.assignedTo) continue;

      // Check if we already sent a reminder for this callback
      // by looking for a recent CALLBACK notification with this callback's ID
      const existingNotification = await prisma.notification.findFirst({
        where: {
          tenantId: callback.tenantId,
          userId: callback.assignedTo,
          type: "CALLBACK",
          data: {
            path: ["callbackId"],
            equals: callback.id,
          },
          createdAt: {
            gte: new Date(now.getTime() - 60 * 60 * 1000), // last hour
          },
        },
      });

      if (existingNotification) {
        continue; // Already reminded
      }

      const timeStr = callback.preferredTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });

      await createNotification({
        tenantId: callback.tenantId,
        userId: callback.assignedTo,
        type: "CALLBACK",
        title: "Callback Reminder",
        body: `Callback with ${callback.lead.customer.name} (${callback.lead.customer.mobile}) at ${timeStr}`,
        data: {
          callbackId: callback.id,
          leadId: callback.leadId,
          customerName: callback.lead.customer.name,
          preferredTime: callback.preferredTime.toISOString(),
        },
      });

      reminded++;
      console.log(`[Callback Worker] Sent reminder for callback ${callback.id}`);
    } catch (err) {
      console.error(`[Callback Worker] Error processing callback ${callback.id}:`, err);
      // Continue with next callback
    }
  }

  return reminded;
}

export function createCallbackWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[Callback Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      return processUpcomingCallbacks();
    },
    {
      connection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[Callback Worker] Job ${job.id} completed, sent ${result} reminders`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Callback Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Callback Worker] Started");
  return worker;
}

export { processUpcomingCallbacks };
