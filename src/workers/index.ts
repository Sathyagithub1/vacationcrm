/**
 * Worker Entry Point
 *
 * Registers all background workers and handles graceful shutdown.
 * Run with: npx tsx src/workers/index.ts
 */
import { createFollowUpWorker } from "./follow-up.worker";
import { createFollowUpRulesWorker } from "./follow-up-rules.worker";
import { createNotificationWorker } from "./notification.worker";
import { createCallbackWorker } from "./callback.worker";
import { createBroadcastWorker } from "./broadcast.worker";
import { createFutureInterestWorker } from "./future-interest.worker";
import { getRedis } from "@/lib/redis";

type WorkerInstance = { close: () => Promise<void> } | null;

const workers: WorkerInstance[] = [];

async function start() {
  console.log("[Workers] Starting background workers...");

  const redis = getRedis();
  if (!redis) {
    console.error("[Workers] Redis not available. Cannot start workers. Set REDIS_URL env var.");
    process.exit(1);
  }

  // Register all workers
  const followUpWorker = createFollowUpWorker();
  const followUpRulesWorker = createFollowUpRulesWorker();
  const notificationWorker = createNotificationWorker();
  const callbackWorker = createCallbackWorker();
  const broadcastWorker = createBroadcastWorker();
  const futureInterestWorker = createFutureInterestWorker();

  workers.push(
    followUpWorker,
    followUpRulesWorker,
    notificationWorker,
    callbackWorker,
    broadcastWorker,
    futureInterestWorker
  );

  const activeCount = workers.filter((w) => w !== null).length;
  console.log(`[Workers] ${activeCount} workers started successfully`);
}

async function shutdown(signal: string) {
  console.log(`\n[Workers] Received ${signal}, shutting down gracefully...`);

  const closePromises = workers
    .filter((w): w is NonNullable<WorkerInstance> => w !== null)
    .map(async (worker) => {
      try {
        await worker.close();
      } catch (err) {
        console.error("[Workers] Error closing worker:", err);
      }
    });

  await Promise.allSettled(closePromises);

  // Close Redis connection
  const redis = getRedis();
  if (redis) {
    try {
      await redis.quit();
    } catch {
      // Ignore disconnect errors
    }
  }

  console.log("[Workers] All workers shut down");
  process.exit(0);
}

// Handle graceful shutdown signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("[Workers] Uncaught exception:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("[Workers] Unhandled rejection:", reason);
  // Don't exit on unhandled rejections -- log and continue
});

// Start workers
start().catch((err) => {
  console.error("[Workers] Failed to start:", err);
  process.exit(1);
});
