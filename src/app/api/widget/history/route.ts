import { NextRequest, NextResponse } from "next/server";
import { tenantPrisma } from "@/lib/prisma";
import { extractVisitorToken } from "@/modules/widget/widget-auth.service";

/**
 * GET /api/widget/history?conversationId=<id>
 *
 * PUBLIC route — authenticated via visitor JWT in Authorization header.
 * Returns chronological message history for the given conversation,
 * scoped to the tenant in the visitor token.
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("Authorization");
    const tokenPayload = extractVisitorToken(authHeader);
    if (!tokenPayload) {
      return NextResponse.json(
        { error: "Unauthorized — missing or invalid visitor token" },
        { status: 401 }
      );
    }

    const { tenantId } = tokenPayload;
    const db = tenantPrisma(tenantId);

    // ── Input validation ──────────────────────────────────────────────────────
    const { searchParams } = request.nextUrl;
    const conversationId = searchParams.get("conversationId")?.trim();

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    // ── Verify conversation belongs to this tenant ─────────────────────────────
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, status: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // ── Fetch messages ─────────────────────────────────────────────────────────
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        senderType: true,
        content: true,
        messageType: true,
        fileUrl: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      conversationId,
      status: conversation.status,
      messages,
    });
  } catch (error) {
    console.error("GET /api/widget/history error:", error);
    return NextResponse.json({ error: "Failed to fetch message history" }, { status: 500 });
  }
}
