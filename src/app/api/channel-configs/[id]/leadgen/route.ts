/**
 * src/app/api/channel-configs/[id]/leadgen/route.ts
 *
 * T51 — Per-page Lead Ads subscription toggle.
 *
 * POST   /api/channel-configs/:id/leadgen — subscribe page to leadgen webhook
 * DELETE /api/channel-configs/:id/leadgen — unsubscribe page from leadgen webhook
 *
 * Both methods:
 *  1. Verify the ChannelConfig belongs to the authenticated tenant and is
 *     a FACEBOOK channel.
 *  2. Extract the page access token from config.access_token or the encrypted
 *     credentials JSON (same fallback logic as the webhook handler).
 *  3. Call the Meta Graph API to subscribe / unsubscribe.
 *  4. Persist the result in ChannelConfig.config.subscribedToLeadgen.
 *
 * Requires: settings:channels permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { decrypt } from "@/lib/encryption";
import {
  subscribePageToLeadgen,
  unsubscribePageFromLeadgen,
} from "@/lib/meta-subscriptions";

type RouteContext = { params: Promise<{ id: string }> };

interface FacebookCredentials {
  appSecret?: string;
  pageAccessToken?: string;
  pageId?: string;
}

interface FacebookConfig {
  page_id?: string;
  access_token?: string;
  subscribedToLeadgen?: boolean;
}

/** Extract the page access token from a ChannelConfig row. */
function extractAccessToken(
  credentials: string,
  config: FacebookConfig | null,
): string | undefined {
  // Preferred: config.access_token (written when connecting the page)
  if (config?.access_token) return config.access_token;

  // Fallback: decrypt credentials JSON and read pageAccessToken
  try {
    const decrypted = decrypt(credentials);
    const creds = JSON.parse(decrypted) as FacebookCredentials;
    return creds.pageAccessToken;
  } catch {
    return undefined;
  }
}

// ── POST — Subscribe ──────────────────────────────────────────────────────────

/**
 * Subscribe the Facebook Page to leadgen webhook notifications.
 */
export async function POST(
  _req: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const { db } = await requirePermission("settings:channels");
    const { id } = await params;

    const channelConfig = await db.channelConfig.findFirst({ where: { id } });

    if (!channelConfig) {
      return NextResponse.json({ error: "Channel config not found" }, { status: 404 });
    }
    if (channelConfig.channel !== "FACEBOOK") {
      return NextResponse.json(
        { error: "Lead Ads subscription is only available for FACEBOOK channels" },
        { status: 400 },
      );
    }

    const cfg = channelConfig.config as FacebookConfig | null;
    const pageId = cfg?.page_id;

    if (!pageId) {
      return NextResponse.json(
        { error: "page_id not found in channel config — re-connect the Facebook page" },
        { status: 400 },
      );
    }

    const accessToken = extractAccessToken(channelConfig.credentials, cfg);

    if (!accessToken) {
      return NextResponse.json(
        { error: "No page access token found — re-connect the Facebook page" },
        { status: 400 },
      );
    }

    const result = await subscribePageToLeadgen(pageId, accessToken);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Meta API call failed" },
        { status: 502 },
      );
    }

    // Persist the subscription flag
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        config: {
          ...(cfg ?? {}),
          subscribedToLeadgen: true,
        },
      },
      select: { id: true, config: true },
    });

    return NextResponse.json({ ok: true, config: updated.config });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/channel-configs/:id/leadgen error:", error);
    return NextResponse.json({ error: "Failed to subscribe to Lead Ads" }, { status: 500 });
  }
}

// ── DELETE — Unsubscribe ──────────────────────────────────────────────────────

/**
 * Unsubscribe the Facebook Page from leadgen webhook notifications.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const { db } = await requirePermission("settings:channels");
    const { id } = await params;

    const channelConfig = await db.channelConfig.findFirst({ where: { id } });

    if (!channelConfig) {
      return NextResponse.json({ error: "Channel config not found" }, { status: 404 });
    }
    if (channelConfig.channel !== "FACEBOOK") {
      return NextResponse.json(
        { error: "Lead Ads subscription is only available for FACEBOOK channels" },
        { status: 400 },
      );
    }

    const cfg = channelConfig.config as FacebookConfig | null;
    const pageId = cfg?.page_id;

    if (!pageId) {
      return NextResponse.json(
        { error: "page_id not found in channel config" },
        { status: 400 },
      );
    }

    const accessToken = extractAccessToken(channelConfig.credentials, cfg);

    if (!accessToken) {
      return NextResponse.json(
        { error: "No page access token found" },
        { status: 400 },
      );
    }

    const result = await unsubscribePageFromLeadgen(pageId, accessToken);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Meta API call failed" },
        { status: 502 },
      );
    }

    // Persist the subscription flag
    const updated = await db.channelConfig.update({
      where: { id },
      data: {
        config: {
          ...(cfg ?? {}),
          subscribedToLeadgen: false,
        },
      },
      select: { id: true, config: true },
    });

    return NextResponse.json({ ok: true, config: updated.config });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("DELETE /api/channel-configs/:id/leadgen error:", error);
    return NextResponse.json({ error: "Failed to unsubscribe from Lead Ads" }, { status: 500 });
  }
}
