/**
 * POST /api/conversations/[id]/escalate
 *
 * Manual escalation: assigns the conversation to a senior agent and creates
 * an Escalation record.  Also optionally triggers auto-escalation evaluation
 * via the `auto` flag.
 *
 * Body:
 *   { reason?: string, targetAgentId?: string }
 *   or { auto: true } — runs evaluateConversation() rules engine
 *
 * Requires: conversations:write permission
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { evaluateConversation } from "@/modules/escalation/auto-escalate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const { user, db } = await requirePermission("conversations:write");

    // Verify conversation belongs to tenant
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, status: true, assignedAgentId: true, leadId: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const { auto, reason, targetAgentId } = body;

    // Auto mode — run the rules engine
    if (auto === true) {
      const result = await evaluateConversation(conversationId);
      if (!result) {
        return NextResponse.json({
          triggered: false,
          message: "No escalation rules triggered",
        });
      }
      return NextResponse.json({
        triggered: true,
        rule: result.triggered,
        action: result.action,
      });
    }

    // Manual escalation
    let targetUser = null;
    if (targetAgentId && typeof targetAgentId === "string") {
      targetUser = await db.user.findFirst({
        where: { id: targetAgentId, isActive: true },
      });
      if (!targetUser) {
        return NextResponse.json({ error: "Target agent not found" }, { status: 404 });
      }
    } else {
      // Auto-select senior agent
      targetUser = await db.user.findFirst({
        where: {
          role: { in: ["DEPT_MANAGER", "COMPANY_ADMIN"] },
          isActive: true,
          id: { not: conversation.assignedAgentId ?? undefined },
        },
        orderBy: { createdAt: "asc" },
      });
    }

    if (!targetUser) {
      return NextResponse.json(
        { error: "No available senior agent found for escalation" },
        { status: 422 }
      );
    }

    const escalationReason =
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : "Manual escalation";

    // Update conversation (anyDb cast for new fields not yet in generated types)
    await anyDb(db).conversation.update({
      where: { id: conversationId },
      data: {
        assignedAgentId: targetUser.id,
        escalatedAt: new Date(),
        escalationReason: escalationReason,
      },
    });

    // Create Escalation record (if lead is attached)
    let escalation = null;
    if (conversation.leadId) {
      escalation = await (db.escalation.create as Function)({
        data: {
          leadId: conversation.leadId,
          conversationId,
          reason: "MANUAL",
          escalatedFrom: user.id,
          escalatedTo: targetUser.id,
          notes: escalationReason,
          status: "OPEN",
        },
      });
    }

    // Notify the target agent
    await db.notification.create({
      data: {
        tenantId: user.tenantId,
        userId: targetUser.id,
        type: "ESCALATION",
        title: "Conversation escalated to you",
        body: `${user.name} has escalated a conversation to you. Reason: ${escalationReason}`,
        data: { conversationId, escalatedBy: user.id },
      },
    });

    return NextResponse.json({
      success: true,
      assignedTo: { id: targetUser.id, name: targetUser.name },
      escalation,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/conversations/[id]/escalate error:", error);
    return NextResponse.json({ error: "Failed to escalate conversation" }, { status: 500 });
  }
}
