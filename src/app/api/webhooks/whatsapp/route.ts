/**
 * POST /api/webhooks/whatsapp?tenantId=<id>
 * GET  /api/webhooks/whatsapp?tenantId=<id>&hub.verify_token=...
 *
 * Public endpoint — no NextAuth session required.
 *
 * Tenant resolution order (POST):
 *   1. `tenantId` query param (legacy single-number per tenant)
 *   2. PhoneNumberId extracted from Meta payload — resolves the tenant that
 *      owns the specific WhatsApp number (multi-number per tenant, 6b.1).
 *
 * Signature verified using the HMAC-SHA256 method (x-hub-signature-256).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveTenant,
  loadChannelConfig,
  logWebhook,
  readRawBody,
  safeParseJson,
  headersToRecord,
} from "@/modules/channels/webhook.utils";
import { createChannelAdapter } from "@/modules/channels/adapters/index";
import { handleInboundMessage } from "@/modules/channels/channel-manager.service";
import { resolveTenantByPhoneNumberId } from "@/modules/channels/multi-whatsapp";
import { decrypt } from "@/lib/encryption";

const CHANNEL = "WHATSAPP" as const;

/**
 * Extracts the WhatsApp phone_number_id from a Meta webhook payload.
 * Returns null when the payload doesn't match the expected shape.
 */
function extractPhoneNumberId(payload: Record<string, unknown>): string | null {
  try {
    const entries = (payload as { entry?: unknown[] }).entry;
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const changes = (entries[0] as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes) || changes.length === 0) return null;
    const value = (changes[0] as { value?: { metadata?: { phone_number_id?: string } } }).value;
    return value?.metadata?.phone_number_id ?? null;
  } catch {
    return null;
  }
}

// ── GET — Meta webhook verification ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tenantId = searchParams.get("tenantId");
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !challenge) {
    return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
  }

  const tenant = await resolveTenant(tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const config = await loadChannelConfig(tenant.id, CHANNEL);
  if (!config) {
    return NextResponse.json({ error: "Channel not configured" }, { status: 404 });
  }

  const credentials = JSON.parse(decrypt(config.credentials)) as { verifyToken?: string };

  if (!credentials.verifyToken || credentials.verifyToken !== token) {
    return NextResponse.json({ error: "Verification token mismatch" }, { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

// ── POST — Inbound messages ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const start = Date.now();
  const { searchParams } = request.nextUrl;
  const tenantId = searchParams.get("tenantId");

  const rawBody = await readRawBody(request);
  const payload = safeParseJson(rawBody);

  if (!payload) {
    await logWebhook({
      tenantId,
      channel: CHANNEL,
      payload: { raw: rawBody.slice(0, 500) },
      status: "FAILED",
      errorMessage: "Invalid JSON payload",
    });
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let tenant = await resolveTenant(tenantId);
  let channelConfigId: string | undefined;

  // 6b.1: If no tenantId param, attempt resolution by phone_number_id in payload
  if (!tenant) {
    const phoneNumberId = extractPhoneNumberId(payload);
    if (phoneNumberId) {
      const resolved = await resolveTenantByPhoneNumberId(phoneNumberId);
      if (resolved) {
        tenant = resolved.tenant;
        channelConfigId = resolved.channelConfig.id;
      }
    }
  }

  if (!tenant) {
    await logWebhook({
      tenantId,
      channel: CHANNEL,
      payload,
      status: "IGNORED",
      errorMessage: "Tenant not found",
    });
    // Return 200 to Meta so it stops retrying unknown tenants
    return NextResponse.json({ status: "ignored" });
  }

  const config = channelConfigId
    ? await (async () => {
        const { tenantPrisma } = await import("@/lib/prisma");
        return tenantPrisma(tenant!.id).channelConfig.findFirst({
          where: { id: channelConfigId, isActive: true },
        });
      })()
    : await loadChannelConfig(tenant.id, CHANNEL);

  if (!config) {
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      payload,
      status: "IGNORED",
      errorMessage: "Channel not configured or inactive",
    });
    return NextResponse.json({ status: "ignored" });
  }

  // Verify HMAC signature
  const headers = headersToRecord(request.headers);
  const adapter = createChannelAdapter(CHANNEL, config.credentials);

  if (!adapter.verifySignature(headers, rawBody)) {
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      payload,
      status: "FAILED",
      errorMessage: "Signature verification failed",
      processingTimeMs: Date.now() - start,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse and route inbound message
  const inbound = adapter.parseInbound(payload);

  if (!inbound) {
    // Could be a status update or unsupported event type
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "status_update",
      payload,
      status: "IGNORED",
      processingTimeMs: Date.now() - start,
    });
    return NextResponse.json({ status: "ok" });
  }

  try {
    await handleInboundMessage(tenant.id, CHANNEL, inbound);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "message",
      payload,
      status: "PROCESSED",
      processingTimeMs: Date.now() - start,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[webhook/whatsapp] handleInboundMessage error:", errMsg);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "message",
      payload,
      status: "FAILED",
      errorMessage: errMsg,
      processingTimeMs: Date.now() - start,
    });
    // Still return 200 — Meta will retry on non-2xx which would create duplicates
    return NextResponse.json({ status: "error", error: errMsg });
  }

  return NextResponse.json({ status: "ok" });
}
