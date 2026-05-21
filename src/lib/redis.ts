import Redis from "ioredis";

let redis: Redis | null = null;
let warned = false;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      console.warn("[Redis] REDIS_URL not configured — Redis features disabled");
      warned = true;
    }
    return null;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redis.connect().catch((err) => {
      console.error("[Redis] Failed to connect:", err.message);
      redis = null;
    });

    return redis;
  } catch (err) {
    console.error("[Redis] Failed to create client:", err);
    return null;
  }
}

export function publishEvent(channel: string, data: unknown) {
  const client = getRedis();
  if (!client) return;

  try {
    client.publish(channel, JSON.stringify(data));
  } catch (err) {
    console.error("[Redis] Publish error:", err);
  }
}
