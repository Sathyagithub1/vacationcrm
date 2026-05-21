/**
 * Broadcast Worker
 *
 * Processes broadcast sends: iterates through PENDING recipients,
 * dispatches messages via the broadcast's channel, and updates statuses.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/modules/notifications/channels/email.channel";
import { sendSms } from "@/modules/notifications/channels/sms.channel";
import { sendWhatsApp } from "@/modules/notifications/channels/whatsapp.channel";

const QUEUE_NAME = "broadcasts";
const BATCH_SIZE = 50;

interface BroadcastJob {
  broadcastId: string;
  tenantId: string;
}

async function processBroadcast(data: BroadcastJob) {
  const { broadcastId } = data;

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
  });

  if (!broadcast) {
    console.error(`[Broadcast Worker] Broadcast ${broadcastId} not found`);
    return;
  }

  if (broadcast.status !== "SENDING") {
    console.warn(`[Broadcast Worker] Broadcast ${broadcastId} is not in SENDING status (${broadcast.status}), skipping`);
    return;
  }

  let deliveredCount = broadcast.deliveredCount;
  let failedCount = broadcast.failedCount;
  let hasMore = true;

  while (hasMore) {
    // Fetch a batch of pending recipients
    const recipients = await prisma.broadcastRecipient.findMany({
      where: {
        broadcastId,
        status: "PENDING",
      },
      include: {
        customer: { select: { id: true, name: true, email: true, mobile: true } },
      },
      take: BATCH_SIZE,
    });

    if (recipients.length === 0) {
      hasMore = false;
      break;
    }

    for (const recipient of recipients) {
      try {
        let sent = false;

        switch (broadcast.channel) {
          case "EMAIL":
            if (recipient.customer.email) {
              sent = await sendEmail({
                to: recipient.customer.email,
                subject: broadcast.title,
                body: broadcast.content,
              });
            } else {
              console.warn(`[Broadcast Worker] No email for customer ${recipient.customerId}`);
            }
            break;

          case "SMS":
            if (recipient.customer.mobile) {
              sent = await sendSms({
                to: recipient.customer.mobile,
                message: `${broadcast.title}: ${broadcast.content}`,
              });
            } else {
              console.warn(`[Broadcast Worker] No mobile for customer ${recipient.customerId}`);
            }
            break;

          case "WHATSAPP":
            if (recipient.customer.mobile) {
              sent = await sendWhatsApp({
                to: recipient.customer.mobile,
                message: `${broadcast.title}\n${broadcast.content}`,
              });
            } else {
              console.warn(`[Broadcast Worker] No mobile for customer ${recipient.customerId}`);
            }
            break;

          case "IN_APP":
            // In-app broadcasts: the recipient record itself serves as the notification
            sent = true;
            break;
        }

        if (sent) {
          await prisma.broadcastRecipient.update({
            where: { id: recipient.id },
            data: { status: "DELIVERED", deliveredAt: new Date() },
          });
          deliveredCount++;
        } else {
          await prisma.broadcastRecipient.update({
            where: { id: recipient.id },
            data: { status: "FAILED", errorMessage: "Channel delivery failed or no contact info" },
          });
          failedCount++;
        }
      } catch (err) {
        console.error(`[Broadcast Worker] Error sending to recipient ${recipient.id}:`, err);
        try {
          await prisma.broadcastRecipient.update({
            where: { id: recipient.id },
            data: {
              status: "FAILED",
              errorMessage: err instanceof Error ? err.message : "Unknown error",
            },
          });
        } catch (updateErr) {
          console.error(`[Broadcast Worker] Failed to update recipient status:`, updateErr);
        }
        failedCount++;
      }
    }

    // Update broadcast counts periodically
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { deliveredCount, failedCount },
    });
  }

  // Final status update
  const finalStatus = failedCount === broadcast.totalRecipients ? "FAILED" : "SENT";
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: finalStatus,
      deliveredCount,
      failedCount,
    },
  });

  console.log(
    `[Broadcast Worker] Broadcast ${broadcastId} complete: ${deliveredCount} delivered, ${failedCount} failed`
  );
}

export function createBroadcastWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[Broadcast Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<BroadcastJob>) => {
      await processBroadcast(job.data);
    },
    {
      connection,
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Broadcast Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Broadcast Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Broadcast Worker] Started");
  return worker;
}

export { processBroadcast };
