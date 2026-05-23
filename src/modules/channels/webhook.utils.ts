/**
 * Shared utilities for all public webhook route handlers.
 *
 * Webhook routes are unauthenticated — tenant is identified from the URL
 * search-param `tenantId` or from the adapter-parsed payload.
 */

import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
import type { ConversationChannel, WebhookLogStatus } from "@prisma/client";

/**
 * Resolves and verifies a tenant from a raw `tenantId` string.
 * Returns null when the tenant does not exist or is suspended.
 */
export async function resolveTenant(tenantId: string | null | undefined) {
  if (!tenantId) return null;
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, subscriptionStatus: { not: "CANCELLED" } },
    select: { id: true, slug: true },
  });
  return tenant ?? null;
}

/**
 * Loads the active ChannelConfig for a tenant+channel combination.
 * Returns null when no config exists or it is disabled.
 */
export async function loadChannelConfig(tenantId: string, channel: ConversationChannel) {
  const db = tenantPrisma(tenantId);
  const config = await db.channelConfig.findFirst({
    where: { channel, isActive: true },
  });
  return config ?? null;
}

/**
 * Writes a WebhookLog row. This function never throws — failures are logged
 * to console so the webhook response is never blocked by a DB write error.
 */
export async function logWebhook(params: {
  tenantId: string | null;
  channel: ConversationChannel;
  eventType?: string;
  payload: Record<string, unknown>;
  status: WebhookLogStatus;
  errorMessage?: string;
  processingTimeMs?: number;
}): Promise<void> {
  try {
    await prisma.webhookLog.create({
      data: {
        tenantId: params.tenantId ?? null,
        channel: params.channel,
        eventType: params.eventType ?? null,
        payload: params.payload,
        status: params.status,
        errorMessage: params.errorMessage ?? null,
        processingTimeMs: params.processingTimeMs ?? null,
      },
    });
  } catch (err) {
    console.error("[WebhookLog] Failed to write log:", err);
  }
}

/**
 * Reads the raw body from a NextRequest as text (needed for HMAC verification
 * before parsing JSON/form-data).
 */
export async function readRawBody(request: Request): Promise<string> {
  return request.text();
}

/**
 * Safely parses JSON; returns null on failure.
 */
export function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Converts a NextRequest headers object to a plain Record<string, string>
 * as expected by ChannelAdapter.verifySignature().
 */
export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}
