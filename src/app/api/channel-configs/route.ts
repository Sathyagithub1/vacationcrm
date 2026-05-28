/**
 * GET  /api/channel-configs          — list all channel configs for the tenant (credentials redacted)
 * POST /api/channel-configs          — create a new channel config (credentials encrypted at rest)
 *
 * Phase 6b change: tenants can now have multiple ChannelConfigs per channel
 * (e.g., multiple WhatsApp Business numbers).  The old @@unique([tenantId, channel])
 * has been replaced with @@unique([tenantId, channel, externalId]).
 *
 * POST validation:
 *  - `externalId` is required for WHATSAPP (it is the phone number ID from Meta).
 *  - `isPrimary=true` flips all other configs for the same channel to isPrimary=false.
 *  - At most one config per (tenant, channel) can have isPrimary=true.
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
import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;

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
export async function GET(request: NextRequest) {
  try {
    const { db } = await requirePermission("settings:channels");

    const { searchParams } = request.nextUrl;
    const channelFilter = searchParams.get("channel");

    const where: Record<string, unknown> = {};
    if (channelFilter && VALID_CHANNELS.includes(channelFilter as ValidChannel)) {
      where.channel = channelFilter;
    }

    const configs = await anyDb(db).channelConfig.findMany({
      where,
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        channel: true,
        label: true,
        externalId: true,
        assignedDepartmentId: true,
        isPrimary: true,
        config: true,
        isActive: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json({ configs: (configs as any[]).map((c: any) => ({ ...c, credentialsSet: true })) });
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

    const body = (await request.json()) as Record<string, unknown>;
    const {
      channel,
      credentials,
      webhookSecret,
      config,
      isActive,
      label,
      externalId,
      assignedDepartmentId,
      isPrimary,
    } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!channel || typeof channel !== "string") {
      return NextResponse.json({ error: "channel is required" }, { status: 400 });
    }
    if (!VALID_CHANNELS.includes(channel as ValidChannel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 }
      );
    }

    const hasCredentials =
      credentials !== undefined &&
      credentials !== null &&
      typeof credentials === "object" &&
      !Array.isArray(credentials);

    if (credentials !== undefined && !hasCredentials) {
      return NextResponse.json(
        { error: "credentials must be a non-empty JSON object" },
        { status: 400 }
      );
    }

    // For WHATSAPP, externalId (phone_number_id) is recommended
    const externalIdStr =
      externalId !== undefined && externalId !== null ? String(externalId) : null;

    // Check for existing config with the same (channel, externalId)
    const existing = await anyDb(db).channelConfig.findFirst({
      where: {
        channel: channel as ValidChannel,
        externalId: externalIdStr,
      },
    });

    if (!existing && !hasCredentials) {
      return NextResponse.json(
        { error: "credentials are required when creating a new channel config" },
        { status: 400 }
      );
    }

    const encryptedCredentials = hasCredentials ? encrypt(JSON.stringify(credentials)) : null;
    const encryptedSecret =
      webhookSecret && typeof webhookSecret === "string" ? encrypt(webhookSecret) : null;

    const SELECT = {
      id: true,
      channel: true,
      label: true,
      externalId: true,
      assignedDepartmentId: true,
      isPrimary: true,
      config: true,
      isActive: true,
      verifiedAt: true,
      createdAt: true,
      updatedAt: true,
    };

    // If isPrimary is being set to true, clear all other primaries for this channel first
    const settingPrimary = isPrimary === true;

    let channelConfig;

    if (existing) {
      // Update existing config
      const updateData: Record<string, unknown> = {};
      if (encryptedCredentials) {
        updateData.credentials = encryptedCredentials;
        updateData.verifiedAt = null;
      }
      if (encryptedSecret !== null) updateData.webhookSecret = encryptedSecret;
      if (config !== undefined) updateData.config = config;
      if (typeof isActive === "boolean") updateData.isActive = isActive;
      if (label !== undefined) updateData.label = label;
      if (assignedDepartmentId !== undefined) updateData.assignedDepartmentId = assignedDepartmentId;

      if (settingPrimary) {
        // Atomic: clear other primaries then set this one
        await prisma.$transaction([
          anyPrisma.channelConfig.updateMany({
            where: {
              tenantId: user.tenantId,
              channel: channel as ValidChannel,
              isPrimary: true,
              id: { not: existing.id },
            },
            data: { isPrimary: false },
          }),
          anyPrisma.channelConfig.update({
            where: { id: existing.id },
            data: { ...updateData, isPrimary: true },
          }),
        ]);
        channelConfig = await anyDb(db).channelConfig.findFirst({ where: { id: existing.id }, select: SELECT });
      } else {
        channelConfig = await anyDb(db).channelConfig.update({
          where: { id: existing.id },
          data: updateData,
          select: SELECT,
        });
      }
    } else {
      // Create new config
      if (settingPrimary) {
        // Clear existing primaries first
        await anyPrisma.channelConfig.updateMany({
          where: {
            tenantId: user.tenantId,
            channel: channel as ValidChannel,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      channelConfig = await anyDb(db).channelConfig.create({
        data: {
          tenantId: user.tenantId,
          channel: channel as ValidChannel,
          credentials: encryptedCredentials!,
          webhookSecret: encryptedSecret,
          config: (config as object) ?? null,
          isActive: typeof isActive === "boolean" ? isActive : false,
          label: typeof label === "string" ? label : null,
          externalId: externalIdStr,
          assignedDepartmentId:
            typeof assignedDepartmentId === "string" ? assignedDepartmentId : null,
          isPrimary: settingPrimary,
        },
        select: SELECT,
      });
    }

    return NextResponse.json(
      { config: { ...channelConfig, credentialsSet: true } },
      { status: existing ? 200 : 201 }
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
