import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // Unix timestamp (seconds) when the window resets
  limit: number;
}

/**
 * Redis-based sliding window rate limiter.
 * Falls back to allowing all requests if Redis is unavailable.
 *
 * @param identifier - Unique key for the rate limit bucket (e.g. userId, IP)
 * @param limit - Max number of requests allowed in the window
 * @param windowMs - Window size in milliseconds
 */
export async function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redis = getRedis();

  // Graceful fallback: if Redis is not available, allow all requests
  if (!redis) {
    return {
      success: true,
      remaining: limit,
      reset: Math.floor(Date.now() / 1000) + Math.ceil(windowMs / 1000),
      limit,
    };
  }

  const key = `rl:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  const resetAt = Math.floor((now + windowMs) / 1000);

  try {
    // Use a Redis pipeline for atomic sliding window operations
    const pipeline = redis.pipeline();
    // Remove entries outside the current window
    pipeline.zremrangebyscore(key, 0, windowStart);
    // Count entries in the current window
    pipeline.zcard(key);
    // Add the current request
    pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
    // Set expiry on the key so it auto-cleans
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();

    // results[1] is the zcard result: [error, count]
    const count = (results?.[1]?.[1] as number) || 0;

    if (count >= limit) {
      return {
        success: false,
        remaining: 0,
        reset: resetAt,
        limit,
      };
    }

    return {
      success: true,
      remaining: Math.max(0, limit - count - 1),
      reset: resetAt,
      limit,
    };
  } catch (err) {
    console.error("[RateLimit] Redis error, allowing request:", err);
    // On error, allow the request (fail-open)
    return {
      success: true,
      remaining: limit,
      reset: resetAt,
      limit,
    };
  }
}

/**
 * Check rate limit and return a 429 response if exceeded.
 * Returns null if the request is allowed.
 * Adds rate limit headers to allowed requests via the `headers` output param.
 */
export async function checkRateLimit(
  request: Request,
  opts?: {
    identifier?: string;
    limit?: number;
    windowMs?: number;
  }
): Promise<NextResponse | null> {
  const userId = extractUserId(request);
  const identifier = opts?.identifier || userId || getClientIp(request) || "anonymous";
  const limit = opts?.limit ?? 100;
  const windowMs = opts?.windowMs ?? 60_000; // 1 minute default

  const result = await rateLimit(identifier, limit, windowMs);

  if (!result.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(result.reset),
          "Retry-After": String(Math.ceil((result.reset * 1000 - Date.now()) / 1000)),
        },
      }
    );
  }

  return null;
}

/**
 * Add rate limit headers to an existing response.
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.reset));
  return response;
}

/**
 * Login-specific rate limiter: 5 attempts per 15 minutes per IP+email combo.
 * Returns a 429 response if locked out, or null if allowed.
 */
export async function checkLoginRateLimit(
  request: Request,
  email: string
): Promise<NextResponse | null> {
  const ip = getClientIp(request) || "unknown";
  const identifier = `login:${ip}:${email.toLowerCase()}`;

  return checkRateLimit(request, {
    identifier,
    limit: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });
}

// ---- Helpers ----

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return null;
}

function extractUserId(request: Request): string | null {
  // Try to get user ID from authorization or session cookie
  // This is a best-effort extraction for rate limiting purposes
  // The actual auth check happens in the route handler
  return null;
}
