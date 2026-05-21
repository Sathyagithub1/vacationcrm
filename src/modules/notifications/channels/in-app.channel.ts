import { publishEvent } from "@/lib/redis";

export interface InAppPayload {
  notificationId: string;
  userId: string;
  tenantId: string;
  type: string;
  title: string;
  body: string;
  data?: unknown;
}

/**
 * In-app notification: the DB record is already created by the notification service.
 * This channel publishes a Redis event so real-time listeners (WebSocket) can push it.
 */
export async function sendInApp(payload: InAppPayload): Promise<boolean> {
  try {
    publishEvent(`notifications:${payload.tenantId}:${payload.userId}`, {
      event: "new-notification",
      notificationId: payload.notificationId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      createdAt: new Date().toISOString(),
    });

    console.log("[In-App Channel] Published notification for user", payload.userId);
    return true;
  } catch (err) {
    console.error("[In-App Channel] Failed to publish:", err);
    return false;
  }
}
