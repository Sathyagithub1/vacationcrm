import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { updateKnowledgeBase, deleteKnowledgeBase } from "@/modules/ai/knowledge-base.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_KB_TYPES = ["FAQ", "SOP", "PRICING", "DOCUMENT", "CUSTOM"];

// PUT /api/knowledge-base/[id] — update an entry
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("settings:general");

    const existing = await db.knowledgeBase.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Knowledge base entry not found" }, { status: 404 });
    }

    const body = await request.json();
    const { title, content, type, isActive } = body;

    if (type !== undefined && !VALID_KB_TYPES.includes(type)) {
      return NextResponse.json({ error: `Type must be one of: ${VALID_KB_TYPES.join(", ")}` }, { status: 400 });
    }
    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    }
    if (content !== undefined && (typeof content !== "string" || !content.trim())) {
      return NextResponse.json({ error: "Content cannot be empty" }, { status: 400 });
    }

    const updateData: { title?: string; content?: string; type?: string; isActive?: boolean } = {};
    if (title !== undefined) updateData.title = title.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (type !== undefined) updateData.type = type;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const entry = await updateKnowledgeBase(db, id, updateData);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "knowledge_base.update",
      entityType: "KnowledgeBase",
      entityId: id,
      oldValue: existing,
      newValue: entry,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Knowledge base entry not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PUT /api/knowledge-base/[id] error:", error);
    return NextResponse.json({ error: "Failed to update knowledge base entry" }, { status: 500 });
  }
}

// DELETE /api/knowledge-base/[id] — delete an entry
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("settings:general");

    const existing = await db.knowledgeBase.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Knowledge base entry not found" }, { status: 404 });
    }

    const entry = await deleteKnowledgeBase(db, id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "knowledge_base.delete",
      entityType: "KnowledgeBase",
      entityId: id,
      oldValue: entry,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Knowledge base entry not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("DELETE /api/knowledge-base/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete knowledge base entry" }, { status: 500 });
  }
}
