import { Queue } from "bullmq";
import { getRedis } from "@/lib/redis";

const queues: Record<string, Queue> = {};

function getConnection() {
  const redis = getRedis();
  if (!redis) return null;
  return redis;
}

export function getQueue(name: string): Queue | null {
  if (queues[name]) return queues[name];

  const connection = getConnection();
  if (!connection) {
    console.warn(`[Queue] Cannot create queue "${name}" — Redis not available`);
    return null;
  }

  const queue = new Queue(name, { connection });
  queues[name] = queue;
  return queue;
}

// Convenience queues
export function getNotificationQueue() {
  return getQueue("notifications");
}

export function getFollowUpQueue() {
  return getQueue("follow-ups");
}

export function getFollowUpRulesQueue() {
  return getQueue("follow-up-rules");
}

export function getCallbackQueue() {
  return getQueue("callbacks");
}

export function getBroadcastQueue() {
  return getQueue("broadcasts");
}

export function getFutureInterestQueue() {
  return getQueue("future-interest");
}

// Add job helpers
export async function addNotificationJob(data: {
  notificationId: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: unknown;
}) {
  const queue = getNotificationQueue();
  if (!queue) {
    console.warn("[Queue] Notification queue unavailable, skipping job");
    return null;
  }
  return queue.add("send-notification", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  });
}

export async function addBroadcastJob(data: {
  broadcastId: string;
  tenantId: string;
}) {
  const queue = getBroadcastQueue();
  if (!queue) {
    console.warn("[Queue] Broadcast queue unavailable, skipping job");
    return null;
  }
  return queue.add("send-broadcast", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

export async function addFollowUpRulesJob(data: {
  tenantId: string;
  leadId: string;
  stageSlug: string;
  assignedTo: string;
}) {
  const queue = getFollowUpRulesQueue();
  if (!queue) {
    console.warn("[Queue] Follow-up rules queue unavailable, skipping job");
    return null;
  }
  return queue.add("stage-change", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  });
}
