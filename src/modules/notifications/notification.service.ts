import { prisma } from "@/lib/prisma";
import { sendEmail } from "./channels/email.channel";
import { sendSms } from "./channels/sms.channel";
import { sendWhatsApp } from "./channels/whatsapp.channel";
import { sendInApp } from "./channels/in-app.channel";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

// Default notification settings — all channels enabled for all types
const DEFAULT_TENANT_SETTINGS: Record<string, Record<string, boolean>> = {
  LEAD_ASSIGNED: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  FOLLOW_UP_DUE: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  ESCALATION: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  CALLBACK: { EMAIL: true, SMS: false, WHATSAPP: false, IN_APP: true },
  NEW_MESSAGE: { EMAIL: false, SMS: false, WHATSAPP: false, IN_APP: true },
};

export type Channel = "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";

export interface CreateNotificationData {
  tenantId: string;
  userId: string;
  type: "LEAD_ASSIGNED" | "FOLLOW_UP_DUE" | "ESCALATION" | "CALLBACK" | "NEW_MESSAGE";
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Create a notification, check tenant/user channel settings, dispatch to enabled channels.
 */
export async function createNotification(data: CreateNotificationData) {
  // 1. Create the notification record (in-app is always the DB record)
  const notification = await prisma.notification.create({
    data: {
      tenantId: data.tenantId,
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      data: data.data || {},
      channelsSent: [],
    },
  });

  // 2. Get tenant notification settings
  const tenant = await prisma.tenant.findUnique({
    where: { id: data.tenantId },
    select: { notificationSettings: true },
  });

  const tenantSettings = (tenant?.notificationSettings as Record<string, Record<string, boolean>> | null)
    || DEFAULT_TENANT_SETTINGS;

  const typeSettings = tenantSettings[data.type] || DEFAULT_TENANT_SETTINGS[data.type] || {};

  // 3. Get user notification preferences (overrides)
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { notificationPreferences: true, email: true, phone: true },
  });

  const userPrefs = (user?.notificationPreferences as Record<string, Record<string, boolean>> | null) || {};
  const userTypePrefs = userPrefs[data.type] || {};

  // 4. Determine which channels to send on
  const channels: Channel[] = [];
  for (const ch of ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as Channel[]) {
    // User preference overrides tenant setting; if user hasn't set preference, use tenant setting
    const enabled = userTypePrefs[ch] !== undefined ? userTypePrefs[ch] : typeSettings[ch];
    if (enabled) channels.push(ch);
  }

  // 5. Dispatch to enabled channels
  const sentChannels: string[] = [];

  for (const ch of channels) {
    let sent = false;

    switch (ch) {
      case "IN_APP":
        sent = await sendInApp({
          notificationId: notification.id,
          userId: data.userId,
          tenantId: data.tenantId,
          type: data.type,
          title: data.title,
          body: data.body,
          data: data.data,
        });
        // In-app always counts as sent (the DB record is the notification)
        sent = true;
        break;

      case "EMAIL":
        if (user?.email) {
          sent = await sendEmail({
            to: user.email,
            subject: data.title,
            body: data.body,
          });
        }
        break;

      case "SMS":
        if (user?.phone) {
          sent = await sendSms({
            to: user.phone,
            message: `${data.title}: ${data.body}`,
          });
        }
        break;

      case "WHATSAPP":
        if (user?.phone) {
          sent = await sendWhatsApp({
            to: user.phone,
            message: `${data.title}\n${data.body}`,
          });
        }
        break;
    }

    if (sent) sentChannels.push(ch);
  }

  // 6. Update channelsSent
  if (sentChannels.length > 0) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { channelsSent: sentChannels },
    });
  }

  return { ...notification, channelsSent: sentChannels };
}

/**
 * Mark notifications as read
 */
export async function markNotificationsRead(db: TenantDb, userId: string, notificationIds?: string[]) {
  const now = new Date();

  if (notificationIds && notificationIds.length > 0) {
    // Mark specific notifications
    await db.notification.updateMany({
      where: {
        userId,
        id: { in: notificationIds },
        readAt: null,
      },
      data: { readAt: now },
    });
  } else {
    // Mark all as read
    await db.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: { readAt: now },
    });
  }
}

/**
 * Get unread count for a user
 */
export async function getUnreadCount(db: TenantDb, userId: string): Promise<number> {
  return db.notification.count({
    where: {
      userId,
      readAt: null,
    },
  });
}

/**
 * List notifications for a user with pagination
 */
export async function listNotifications(
  db: TenantDb,
  userId: string,
  opts: { page?: number; limit?: number; unreadOnly?: boolean } = {}
) {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { userId };
  if (opts.unreadOnly) {
    where.readAt = null;
  }

  const [notifications, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.notification.count({ where }),
  ]);

  return {
    notifications,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}
