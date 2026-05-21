import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import { getMessages, sendMessage } from "@/modules/conversations/chat.service";

// GET /api/conversations/[id]/messages — list messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    // Verify conversation exists
    const conversation = await db.conversation.findFirst({ where: { id } });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const result = await getMessages(db, id, page, limit);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/conversations/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

// POST /api/conversations/[id]/messages — send a message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requireAuth();

    const body = await request.json();
    const { content, messageType, fileUrl } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    // Phase 1: only agents send messages via this endpoint.
    // Force senderType to AGENT and senderId to the authenticated user.
    const message = await sendMessage(db, {
      conversationId: id,
      senderType: "AGENT",
      senderId: user.id,
      content: content.trim(),
      messageType: messageType || "TEXT",
      fileUrl: fileUrl || null,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Conversation not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message.includes("closed")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("POST /api/conversations/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
