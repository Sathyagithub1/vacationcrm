import { NextResponse } from "next/server";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { getConversationDetail, closeConversation } from "@/modules/conversations/chat.service";
import { logAudit } from "@/modules/audit/audit.service";

/**
 * Checks whether the authenticated user is permitted to access the given
 * conversation.  Returns a 403 NextResponse if access is denied, or null
 * if access is allowed.
 *
 * Decision logic (Conversation has `assignedAgentId`; its lead has
 * `departmentId` and `assignedTo`):
 *  - AGENT        → only own conversations (assignedAgentId === user.id),
 *                   falling back to lead.assignedTo when assignedAgentId is
 *                   null (e.g. inbound conversations not yet assigned).
 *  - DEPT_MANAGER → only conversations whose linked lead belongs to the
 *                   manager's department.
 *  - All others   → unrestricted within the tenant (tenantPrisma already
 *                   injects the tenantId filter).
 */
function checkConversationAccess(
  conversation: {
    assignedAgentId: string | null;
    lead: { departmentId: string; assignedTo: string | null } | null;
  },
  user: { role: string; id: string; departmentId: string | null | undefined }
): NextResponse | null {
  if (user.role === "AGENT") {
    const ownedByAgent =
      conversation.assignedAgentId === user.id ||
      (conversation.assignedAgentId === null &&
        conversation.lead?.assignedTo === user.id);
    if (!ownedByAgent) return forbidden();
  }

  if (user.role === "DEPT_MANAGER" && user.departmentId) {
    if (conversation.lead?.departmentId !== user.departmentId) return forbidden();
  }

  return null;
}

// GET /api/conversations/[id] — get conversation detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requireAuth();

    const conversation = await getConversationDetail(db, id);

    const deny = checkConversationAccess(conversation, user);
    if (deny) return deny;

    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Conversation not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("GET /api/conversations/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}

// PATCH /api/conversations/[id] — close conversation
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body;

    if (action !== "close") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const { user, db } = await requireAuth();

    // Ownership check before mutating
    const existing = await getConversationDetail(db, id);
    const deny = checkConversationAccess(existing, user);
    if (deny) return deny;

    const conversation = await closeConversation(db, id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "conversation.close",
      entityType: "Conversation",
      entityId: id,
      newValue: { status: "CLOSED" },
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Conversation not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message === "Already closed") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("PATCH /api/conversations/[id] error:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }
}
