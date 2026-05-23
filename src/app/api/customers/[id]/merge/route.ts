/**
 * POST /api/customers/:id/merge
 *
 * Merges two customer records. The customer identified by :id is the TARGET
 * (kept). The sourceCustomerId from the request body is the source (deleted).
 *
 * Moves all associated records from source → target in a single transaction:
 *  - Lead (customerId)
 *  - Conversation (customerId)
 *  - CustomerChannel (customerId) — skips duplicate (channel, externalId) entries
 *  - FollowUp (via Lead cascade, already covered)
 *  - BroadcastRecipient (customerId)
 *  - WidgetVisitor (customerId)
 *
 * Then deletes the source customer.
 *
 * Requires: leads:edit permission (company admin / dept manager level).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetId } = await params;
    const { user, db } = await requirePermission("leads:edit");

    const body = await request.json() as Record<string, unknown>;
    const sourceId = typeof body.sourceCustomerId === "string" ? body.sourceCustomerId.trim() : "";

    if (!sourceId) {
      return NextResponse.json({ error: "sourceCustomerId is required" }, { status: 400 });
    }

    if (sourceId === targetId) {
      return NextResponse.json({ error: "Source and target customer must be different" }, { status: 400 });
    }

    // Verify both customers belong to this tenant
    const [target, source] = await Promise.all([
      db.customer.findFirst({ where: { id: targetId } }),
      db.customer.findFirst({ where: { id: sourceId } }),
    ]);

    if (!target) {
      return NextResponse.json({ error: "Target customer not found" }, { status: 404 });
    }
    if (!source) {
      return NextResponse.json({ error: "Source customer not found" }, { status: 404 });
    }

    // Retrieve existing CustomerChannel externalId pairs on the target to detect conflicts
    const targetChannels = await db.customerChannel.findMany({
      where: { customerId: targetId },
      select: { channel: true, externalId: true },
    });
    const targetChannelSet = new Set(
      targetChannels.map((c) => `${c.channel}::${c.externalId}`)
    );

    // Load source channels to figure out which can be migrated vs. must be dropped
    const sourceChannels = await db.customerChannel.findMany({
      where: { customerId: sourceId },
      select: { id: true, channel: true, externalId: true },
    });

    const migratable = sourceChannels.filter(
      (c) => !targetChannelSet.has(`${c.channel}::${c.externalId}`)
    );
    const duplicateIds = sourceChannels
      .filter((c) => targetChannelSet.has(`${c.channel}::${c.externalId}`))
      .map((c) => c.id);

    // Execute all moves inside a transaction using the raw prisma client
    // (tenantPrisma extension does not expose $transaction)
    await prisma.$transaction(async (tx) => {
      // Move leads
      await tx.lead.updateMany({
        where: { customerId: sourceId, tenantId: user.tenantId },
        data: { customerId: targetId },
      });

      // Move conversations
      await tx.conversation.updateMany({
        where: { customerId: sourceId, tenantId: user.tenantId },
        data: { customerId: targetId },
      });

      // Move broadcast recipients
      await tx.broadcastRecipient.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      });

      // Move widget visitors
      await tx.widgetVisitor.updateMany({
        where: { customerId: sourceId, tenantId: user.tenantId },
        data: { customerId: targetId },
      });

      // Move non-duplicate customer channels
      if (migratable.length > 0) {
        await tx.customerChannel.updateMany({
          where: { id: { in: migratable.map((c) => c.id) } },
          data: { customerId: targetId },
        });
      }

      // Delete duplicate customer channels (can't move — would violate unique constraint)
      if (duplicateIds.length > 0) {
        await tx.customerChannel.deleteMany({
          where: { id: { in: duplicateIds } },
        });
      }

      // Delete the source customer
      await tx.customer.delete({
        where: { id: sourceId },
      });

      // Update target's totalLeads count
      const leadCount = await tx.lead.count({
        where: { customerId: targetId, tenantId: user.tenantId },
      });
      await tx.customer.update({
        where: { id: targetId },
        data: { totalLeads: leadCount },
      });
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "customer.merge",
      entityType: "Customer",
      entityId: targetId,
      oldValue: { sourceCustomerId: sourceId },
      newValue: { targetCustomerId: targetId, migratedChannels: migratable.length, droppedDuplicateChannels: duplicateIds.length },
    });

    const merged = await db.customer.findFirst({ where: { id: targetId } });

    return NextResponse.json({
      customer: merged,
      merged: {
        migratedChannels: migratable.length,
        droppedDuplicateChannels: duplicateIds.length,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/customers/:id/merge error:", error);
    return NextResponse.json({ error: "Failed to merge customers" }, { status: 500 });
  }
}
