/**
 * POST /api/channel-configs/:id/test
 *
 * Tests the channel connection by sending a short test message to a
 * specified recipient via the adapter. On success marks verifiedAt.
 *
 * Request body: { recipientExternalId: string }
 *
 * Requires: settings:channels permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { createChannelAdapter } from "@/modules/channels/adapters/index";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, db } = await requirePermission("settings:channels");
    const { id } = await params;

    const config = await db.channelConfig.findFirst({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: "Channel config not found" }, { status: 404 });
    }

    const body = await request.json() as Record<string, unknown>;
    const recipientExternalId =
      typeof body.recipientExternalId === "string" ? body.recipientExternalId.trim() : "";

    if (!recipientExternalId) {
      return NextResponse.json(
        { error: "recipientExternalId is required — provide the external ID to send the test message to" },
        { status: 400 }
      );
    }

    const tenant = await db.tenant.findUnique({
      where: { id: user.tenantId },
      select: { productName: true },
    });
    const productName = tenant?.productName ?? "this CRM";

    const adapter = createChannelAdapter(config.channel, config.credentials);

    const result = await adapter.sendMessage({
      externalId: recipientExternalId,
      content: `This is a test message from ${productName}. Your channel connection is working correctly.`,
      messageType: "TEXT",
    });

    if (result.success) {
      // Mark the config as verified
      await db.channelConfig.update({
        where: { id },
        data: { verifiedAt: new Date(), isActive: true },
      });
    }

    return NextResponse.json({
      success: result.success,
      externalMessageId: result.externalMessageId ?? null,
      error: result.error ?? null,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/channel-configs/:id/test error:", error);
    return NextResponse.json({ error: "Failed to test channel connection" }, { status: 500 });
  }
}
