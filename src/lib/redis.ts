import Redis from "ioredis";

let client: Redis | null = null;
let warned = false;

export function getRedis(): Redis | null {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      console.warn("[Redis] REDIS_URL not configured — Redis features disabled");
      warned = true;
    }
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    client.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    client.connect().catch((err) => {
      console.error("[Redis] Failed to connect:", err.message);
      client = null;
    });

    return client;
  } catch (err) {
    console.error("[Redis] Failed to create client:", err);
    return null;
  }
}

/**
 * A Proxy-based Redis client that lazily resolves the underlying ioredis
 * instance on first method access. Allows callers to write
 *   import { redis } from "@/lib/redis";
 *   await redis.incr(key);
 * without juggling `getRedis()` null checks at every callsite.
 *
 * Will throw at access time if REDIS_URL is unconfigured.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop, receiver) {
    const instance = getRedis();
    if (!instance) {
      throw new Error(
        "Redis is not configured (REDIS_URL missing). Set REDIS_URL to use the `redis` client."
      );
    }
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export function publishEvent(channel: string, data: unknown) {
  const client = getRedis();
  if (!client) return;

  try {
    client.publish(channel, JSON.stringify(data));
  } catch (err) {
    console.error("[Redis] Publish error:", err);
  }
}
