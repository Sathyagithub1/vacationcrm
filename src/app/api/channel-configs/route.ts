/**
 * GET  /api/channel-configs — list all channel configs for the tenant (credentials redacted)
 * POST /api/channel-configs — create a new channel config (credentials encrypted at rest)
 *
 * Requires: settings:channels permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { encrypt } from "@/lib/encryption";

const VALID_CHANNELS = [
  "WHATSAPP",
  "FACEBOOK",
  "INSTAGRAM",
  "EMAIL",
  "SMS",
  "TELEGRAM",
  "WEBSITE",
] as const;

type ValidChannel = (typeof VALID_CHANNELS)[number];

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest) {
  try {
    const { db } = await requirePermission("settings:channels");

    const configs = await db.channelConfig.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channel: true,
        // Never return decrypted credentials — return masked indicator only
        credentials: false,
        webhookSecret: false,
        config: true,
        isActive: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Add a hasCredentials flag so the UI knows whether config is complete
    const safeConfigs = configs.map((c) => ({
      ...c,
      hasCredentials: true, // they exist if the row exists
      credentialsSet: true,
    }));

    return NextResponse.json({ configs: safeConfigs });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/channel-configs error:", error);
    return NextResponse.json({ error: "Failed to fetch channel configs" }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("settings:channels");

    const body = await request.json() as Record<string, unknown>;
    const { channel, credentials, webhookSecret, config, isActive } = body;

    // Validation
    if (!channel || typeof channel !== "string") {
      return NextResponse.json({ error: "channel is required" }, { status: 400 });
    }
    if (!VALID_CHANNELS.includes(channel as ValidChannel)) {
      return NextResponse.json({ error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` }, { status: 400 });
    }
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return NextResponse.json(
        { error: "credentials must be a non-empty JSON object" },
        { status: 400 }
      );
    }

    // Encrypt credentials at rest
    const encryptedCredentials = encrypt(JSON.stringify(credentials));
    const encryptedSecret =
      webhookSecret && typeof webhookSecret === "string"
        ? encrypt(webhookSecret)
        : null;

    // Upsert — each tenant can only have one config per channel
    const channelConfig = await db.channelConfig.upsert({
      where: {
        // tenantId injected by tenantPrisma; unique on (tenantId, channel)
        // Prisma upsert where must use the unique key fields
        tenantId_channel: {
          tenantId: user.tenantId,
          channel: channel as ValidChannel,
        },
      },
      create: {
        channel: channel as ValidChannel,
        credentials: encryptedCredentials,
        webhookSecret: encryptedSecret,
        config: (config as object) ?? null,
        isActive: typeof isActive === "boolean" ? isActive : false,
      },
      update: {
        credentials: encryptedCredentials,
        webhookSecret: encryptedSecret ?? undefined,
        config: (config as object) ?? undefined,
        isActive: typeof isActive === "boolean" ? isActive : undefined,
        verifiedAt: null, // Reset verification on credential change
      },
      select: {
        id: true,
        channel: true,
        credentials: false,
        webhookSecret: false,
        config: true,
        isActive: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { config: { ...channelConfig, credentialsSet: true } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/channel-configs error:", error);
    return NextResponse.json({ error: "Failed to create channel config" }, { status: 500 });
  }
}
