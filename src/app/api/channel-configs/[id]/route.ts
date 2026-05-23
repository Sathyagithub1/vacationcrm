/**
 * PUT    /api/channel-configs/:id — update channel config
 * DELETE /api/channel-configs/:id — delete channel config
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

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { db } = await requirePermission("settings:channels");
    const { id } = await params;

    // Confirm ownership
    const existing = await db.channelConfig.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Channel config not found" }, { status: 404 });
    }

    const body = await request.json() as Record<string, unknown>;
    const { credentials, webhookSecret, config, isActive } = body;

    const updateData: Record<string, unknown> = {};

    if (credentials !== undefined) {
      if (typeof credentials !== "object" || Array.isArray(credentials) || credentials === null) {
        return NextResponse.json(
          { error: "credentials must be a non-empty JSON object" },
          { status: 400 }
        );
      }
      updateData.credentials = encrypt(JSON.stringify(credentials));
      updateData.verifiedAt = null; // Reset verification on credential change
    }

    if (webhookSecret !== undefined) {
      updateData.webhookSecret =
        typeof webhookSecret === "string" && webhookSecret.trim()
          ? encrypt(webhookSecret.trim())
          : null;
    }

    if (config !== undefined) {
      updateData.config = config;
    }

    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const updated = await db.channelConfig.update({
      where: { id },
      data: updateData,
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

    return NextResponse.json({ config: { ...updated, credentialsSet: true } });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/channel-configs/:id error:", error);
    return NextResponse.json({ error: "Failed to update channel config" }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { db } = await requirePermission("settings:channels");
    const { id } = await params;

    const existing = await db.channelConfig.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Channel config not found" }, { status: 404 });
    }

    await db.channelConfig.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("DELETE /api/channel-configs/:id error:", error);
    return NextResponse.json({ error: "Failed to delete channel config" }, { status: 500 });
  }
}
