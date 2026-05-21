/**
 * Notification Worker
 *
 * Processes notification dispatch jobs, sending through the appropriate channels
 * (email, SMS, WhatsApp, in-app) based on tenant/user preferences.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/modules/notifications/channels/email.channel";
import { sendSms } from "@/modules/notifications/channels/sms.channel";
import { sendWhatsApp } from "@/modules/notifications/channels/whatsapp.channel";
import { sendInApp } from "@/modules/notifications/channels/in-app.channel";

const QUEUE_NAME = "notifications";

const DEFAULT_TENANT_SETTINGS: Record<string, Record<string, boolean>> = {
  LEAD_ASSIGNED: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  FOLLOW_UP_DUE: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  ESCALATION: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  CALLBACK: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  NEW_MESSAGE: { EMAIL: false, SMS: false, WHATSAPP: false, IN_APP: true },
};

type Channel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

interface NotificationJob {
  notificationId: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: unknown;
}

async function processNotification(jobData: NotificationJob) {
  const { notificationId, tenantId, userId, type, title, body, data } = jobData;

  // Get tenant settings
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { notificationSettings: true },
  });

  const tenantSettings =
    (tenant?.notificationSettings as Record<string, Record<string, boolean>> | null) ||
    DEFAULT_TENANT_SETTINGS;
  const typeSettings = tenantSettings[type] || DEFAULT_TENANT_SETTINGS[type] || {};

  // Get user preferences and contact info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notificationPreferences: true, email: true, phone: true },
  });

  if (!user) {
    console.warn(`[Notification Worker] User ${userId} not found, skipping`);
    return;
  }

  const userPrefs =
    (user.notificationPreferences as Record<string, Record<string, boolean>> | null) || {};
  const userTypePrefs = userPrefs[type] || {};

  // Determine channels
  const channels: Channel[] = [];
  for (const ch of ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as Channel[]) {
    const enabled = userTypePrefs[ch] !== undefined ? userTypePrefs[ch] : typeSettings[ch];
    if (enabled) channels.push(ch);
  }

  const sentChannels: string[] = [];

  for (const ch of channels) {
    try {
      let sent = false;

      switch (ch) {
        case "IN_APP":
          await sendInApp({
            notificationId,
            userId,
            tenantId,
            type,
            title,
            body,
            data,
          });
          sent = true;
          break;

        case "EMAIL":
          if (user.email) {
            sent = await sendEmail({ to: user.email, subject: title, body });
          }
          break;

        case "SMS":
          if (user.phone) {
            sent = await sendSms({ to: user.phone, message: `${title}: ${body}` });
          }
          break;

        case "WHATSAPP":
          if (user.phone) {
            sent = await sendWhatsApp({ to: user.phone, message: `${title}\n${body}` });
          }
          break;
      }

      if (sent) sentChannels.push(ch);
    } catch (err) {
      console.error(`[Notification Worker] Channel ${ch} failed for notification ${notificationId}:`, err);
      // Continue with other channels
    }
  }

  // Update channels sent on the notification record
  if (sentChannels.length > 0) {
    try {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { channelsSent: sentChannels },
      });
    } catch (err) {
      console.error(`[Notification Worker] Failed to update channelsSent for ${notificationId}:`, err);
    }
  }

  console.log(
    `[Notification Worker] Processed ${notificationId}: sent via ${sentChannels.join(", ") || "none"}`
  );
}

export function createNotificationWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[Notification Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<NotificationJob>) => {
      await processNotification(job.data);
    },
    {
      connection,
      concurrency: 10,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Notification Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Notification Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Notification Worker] Started");
  return worker;
}

export { processNotification };
