import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { processAIMessage } from "@/modules/ai/ai-chat.service";

// POST /api/ai/chat
// Receives a customer message, saves it, runs AI processing, returns the bot response.
export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();

    const body = await request.json();
    const { conversationId, departmentId, message, customerId } = body as {
      conversationId?: string;
      departmentId?: string;
      message?: string;
      customerId?: string;
    };

    // Validation
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 }
      );
    }
    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json(
        { error: "departmentId is required" },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    // Verify the conversation belongs to this tenant
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, status: true },
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Persist the incoming customer message before processing
    await db.message.create({
      data: {
        tenantId: user.tenantId,
        conversationId,
        senderType: "CUSTOMER",
        content: message.trim(),
      },
    });

    // Orchestrate AI response
    const result = await processAIMessage({
      db,
      tenantId: user.tenantId,
      conversationId,
      departmentId,
      customerMessage: message.trim(),
      customerId,
    });

    return NextResponse.json({
      response: result.response,
      handoff: result.handoff,
      toolResults: result.toolResults,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("POST /api/ai/chat error:", error);
    return NextResponse.json(
      { error: "Failed to process AI message" },
      { status: 500 }
    );
  }
}
