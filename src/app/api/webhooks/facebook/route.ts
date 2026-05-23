/**
 * POST /api/webhooks/facebook?tenantId=<id>
 * GET  /api/webhooks/facebook?tenantId=<id>&hub.verify_token=...
 *
 * Public endpoint — Meta Graph API webhook for Facebook Messenger.
 * Signature verified using x-hub-signature-256 HMAC.
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

const CHANNEL = "FACEBOOK" as const;

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

  const { decrypt } = await import("@/lib/encryption");
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

  const tenant = await resolveTenant(tenantId);
  if (!tenant) {
    await logWebhook({
      tenantId,
      channel: CHANNEL,
      payload,
      status: "IGNORED",
      errorMessage: "Tenant not found",
    });
    return NextResponse.json({ status: "ignored" });
  }

  const config = await loadChannelConfig(tenant.id, CHANNEL);
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

  const inbound = adapter.parseInbound(payload);

  if (!inbound) {
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
    console.error("[webhook/facebook] handleInboundMessage error:", errMsg);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "message",
      payload,
      status: "FAILED",
      errorMessage: errMsg,
      processingTimeMs: Date.now() - start,
    });
    return NextResponse.json({ status: "error", error: errMsg });
  }

  return NextResponse.json({ status: "ok" });
}
