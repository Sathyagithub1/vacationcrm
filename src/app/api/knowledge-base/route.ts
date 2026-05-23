import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { listKnowledgeBases, createKnowledgeBase } from "@/modules/ai/knowledge-base.service";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_KB_TYPES = ["FAQ", "SOP", "PRICING", "DOCUMENT", "CUSTOM"];

// GET /api/knowledge-base — list, filterable by departmentId and type
// RBAC: DEPT_MANAGER sees only their own department's entries
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const departmentIdParam = searchParams.get("departmentId") || "";
    const typeParam = searchParams.get("type") || "";
    const isActiveParam = searchParams.get("isActive");

    const filters: { departmentId?: string; type?: string; isActive?: boolean } = {};

    // DEPT_MANAGER is restricted to their own department only
    if (user.role === "DEPT_MANAGER" && user.departmentId) {
      filters.departmentId = user.departmentId;
    } else if (departmentIdParam) {
      filters.departmentId = departmentIdParam;
    }

    if (typeParam && VALID_KB_TYPES.includes(typeParam)) {
      filters.type = typeParam;
    }

    if (isActiveParam === "true") filters.isActive = true;
    if (isActiveParam === "false") filters.isActive = false;

    const entries = await listKnowledgeBases(db, filters);

    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/knowledge-base error:", error);
    return NextResponse.json({ error: "Failed to fetch knowledge base entries" }, { status: 500 });
  }
}

// POST /api/knowledge-base — create a new entry
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("settings:general");

    const body = await request.json();
    const { departmentId, type, title, content } = body;

    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "Department is required" }, { status: 400 });
    }
    if (!type || !VALID_KB_TYPES.includes(type)) {
      return NextResponse.json({ error: `Type must be one of: ${VALID_KB_TYPES.join(", ")}` }, { status: 400 });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const dept = await db.department.findFirst({ where: { id: departmentId } });
    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const entry = await createKnowledgeBase(db, {
      departmentId,
      type,
      title: title.trim(),
      content: content.trim(),
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "knowledge_base.create",
      entityType: "KnowledgeBase",
      entityId: entry.id,
      newValue: entry,
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/knowledge-base error:", error);
    return NextResponse.json({ error: "Failed to create knowledge base entry" }, { status: 500 });
  }
}
