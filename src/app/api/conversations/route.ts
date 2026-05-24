import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { createConversation, listConversations } from "@/modules/conversations/chat.service";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/conversations — list conversations
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const status = searchParams.get("status") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    // RBAC: agents see only their own conversations;
    // dept managers see only conversations linked to leads in their department.
    let assignedAgentId: string | undefined;
    let leadDepartmentId: string | undefined;
    if (user.role === "AGENT") {
      assignedAgentId = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      leadDepartmentId = user.departmentId;
    }

    const result = await listConversations(db, {
      status: status || undefined,
      assignedAgentId,
      leadDepartmentId,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/conversations error:", error);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }
}

// POST /api/conversations — create a conversation from a lead
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("conversations:view");

    const body = await request.json();
    const { leadId } = body;

    if (!leadId || typeof leadId !== "string") {
      return NextResponse.json({ error: "Lead ID is required" }, { status: 400 });
    }

    const conversation = await createConversation(db, {
      leadId,
      assignedAgentId: user.id,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "conversation.create",
      entityType: "Conversation",
      entityId: conversation.id,
      newValue: conversation,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Lead not found" || error.message === "Agent not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message.includes("already exists")) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    console.error("POST /api/conversations error:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }
}
