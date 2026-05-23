/**
 * POST /api/webhooks/sms?tenantId=<id>
 *
 * Public endpoint — Twilio SMS inbound webhook.
 * Twilio delivers form-encoded fields (application/x-www-form-urlencoded).
 * Signature verified using X-Twilio-Signature HMAC.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveTenant,
  loadChannelConfig,
  logWebhook,
  headersToRecord,
} from "@/modules/channels/webhook.utils";
import { createChannelAdapter } from "@/modules/channels/adapters/index";
import { handleInboundMessage } from "@/modules/channels/channel-manager.service";

const CHANNEL = "SMS" as const;

export async function POST(request: NextRequest) {
  const start = Date.now();
  const { searchParams } = request.nextUrl;
  const tenantId = searchParams.get("tenantId");

  // Twilio sends application/x-www-form-urlencoded
  let formText = "";
  const payload: Record<string, unknown> = {};

  try {
    formText = await request.text();
    const params = new URLSearchParams(formText);
    params.forEach((value, key) => {
      payload[key] = value;
    });
  } catch {
    await logWebhook({
      tenantId,
      channel: CHANNEL,
      payload: {},
      status: "FAILED",
      errorMessage: "Failed to parse form-encoded payload",
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

  if (!adapter.verifySignature(headers, formText)) {
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
    // Twilio expects a 200 TwiML response for status callbacks
    return new NextResponse("<Response/>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  try {
    await handleInboundMessage(tenant.id, CHANNEL, inbound);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "sms_received",
      payload,
      status: "PROCESSED",
      processingTimeMs: Date.now() - start,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[webhook/sms] handleInboundMessage error:", errMsg);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "sms_received",
      payload,
      status: "FAILED",
      errorMessage: errMsg,
      processingTimeMs: Date.now() - start,
    });
  }

  // Return empty TwiML so Twilio doesn't auto-reply
  return new NextResponse("<Response/>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
