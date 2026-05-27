/**
 * src/app/api/conversations/[id]/mark-spam/route.ts
 *
 * T41 — Mark conversation sender as spam.
 *
 * POST /api/conversations/:id/mark-spam
 *
 * Body:
 *   {
 *     channels:      string[]   — channel scope for the new SpamRule
 *     departmentIds: string[]   — department scope (empty = all)
 *     reason?:       string
 *   }
 *
 * Action:
 *   1. Resolves the conversation + its customer (the sender identifier).
 *   2. Creates a BLACKLIST SpamRule with the customer's mobile as identifier.
 *   3. Soft-deletes (marks senderType=CUSTOMER messages as deleted if status=ACTIVE)
 *      — since Message has no deletedAt column, we close (set status=CLOSED) all
 *      open Conversations from this customer. This is the appropriate "bulk soft
 *      delete" within the current schema.
 *   4. Returns the created SpamRule.
 *
 * JUDGMENT CALL: Message has no deletedAt. "Bulk-soft-deletes open messages"
 * is implemented as closing all ACTIVE conversations from this sender.
 * If a true per-message deletion field is added in a future migration,
 * update this handler to set it on Message rows instead.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: conversationId } = await context.params;
    const { user, db } = await requirePermission("leads:edit");

    // ── 1. Resolve conversation + sender ────────────────────────────────────
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId },
      include: { customer: { select: { id: true, mobile: true, name: true } } },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const customer = conversation.customer;
    if (!customer) {
      return NextResponse.json(
        { error: "Conversation has no linked customer — cannot determine sender identifier" },
        { status: 422 },
      );
    }

    // ── 2. Parse + validate body ────────────────────────────────────────────
    const body = (await request.json()) as Record<string, unknown>;

    const channels = Array.isArray(body.channels)
      ? (body.channels as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const departmentIds = Array.isArray(body.departmentIds)
      ? (body.departmentIds as unknown[]).filter((d): d is string => typeof d === "string")
      : [];
    const reason = typeof body.reason === "string" ? body.reason : `Marked as spam by user ${user.id}`;

    // ── 3. Create BLACKLIST SpamRule ────────────────────────────────────────
    const rule = await db.spamRule.create({
      data: {
        tenantId:     user.tenantId,
        type:         "BLACKLIST",
        identifier:   customer.mobile,
        reason,
        channels,
        departmentIds,
        createdById:  user.id,
        isActive:     true,
      },
    });

    // ── 4. Close all ACTIVE conversations from this customer ────────────────
    // This is the "bulk soft-delete" within the current schema (no deletedAt on Message).
    // Closes every ACTIVE conversation linked to this customer across the tenant.
    await db.conversation.updateMany({
      where: {
        customerId: customer.id,
        status: "ACTIVE",
      },
      data: {
        status:   "CLOSED",
        closedAt: new Date(),
      },
    });

    return NextResponse.json({ rule, closedConversations: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("POST /api/conversations/[id]/mark-spam error:", err);
    return NextResponse.json({ error: "Failed to mark conversation as spam" }, { status: 500 });
  }
}
