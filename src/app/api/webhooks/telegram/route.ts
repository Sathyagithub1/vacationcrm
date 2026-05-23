/**
 * POST /api/webhooks/telegram?tenantId=<id>
 *
 * Public endpoint — Telegram Bot API webhook.
 * Telegram sends JSON. Verification uses X-Telegram-Bot-Api-Secret-Token header
 * which matches the secret_token set during setWebhook.
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

const CHANNEL = "TELEGRAM" as const;

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inbound = adapter.parseInbound(payload);

  if (!inbound) {
    // Could be a callback_query, edited_message, etc.
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "non_message_update",
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
    console.error("[webhook/telegram] handleInboundMessage error:", errMsg);
    await logWebhook({
      tenantId: tenant.id,
      channel: CHANNEL,
      eventType: "message",
      payload,
      status: "FAILED",
      errorMessage: errMsg,
      processingTimeMs: Date.now() - start,
    });
  }

  return NextResponse.json({ status: "ok" });
}
