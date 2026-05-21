import { NextResponse } from "next/server";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { getConversationDetail, closeConversation } from "@/modules/conversations/chat.service";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/conversations/[id] — get conversation detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requireAuth();

    const conversation = await getConversationDetail(db, id);
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
