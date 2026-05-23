import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { logAudit } from "@/modules/audit/audit.service";

const VALID_KB_TYPES = ["FAQ", "SOP", "PRICING", "DOCUMENT", "CUSTOM"];

interface ImportEntry {
  type: string;
  title: string;
  content: string;
}

// POST /api/knowledge-base/import — bulk import entries for a department
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("settings:general");

    const body = await request.json();
    const { departmentId, entries } = body;

    if (!departmentId || typeof departmentId !== "string") {
      return NextResponse.json({ error: "Department is required" }, { status: 400 });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "entries must be a non-empty array" }, { status: 400 });
    }

    if (entries.length > 500) {
      return NextResponse.json({ error: "Cannot import more than 500 entries at once" }, { status: 400 });
    }

    const dept = await db.department.findFirst({ where: { id: departmentId } });
    if (!dept) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // Validate every entry before inserting any
    for (let i = 0; i < entries.length; i++) {
      const entry: ImportEntry = entries[i];

      if (!entry.type || !VALID_KB_TYPES.includes(entry.type)) {
        return NextResponse.json(
          { error: `Entry at index ${i}: type must be one of ${VALID_KB_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
      if (!entry.title || typeof entry.title !== "string" || !entry.title.trim()) {
        return NextResponse.json(
          { error: `Entry at index ${i}: title is required` },
          { status: 400 }
        );
      }
      if (!entry.content || typeof entry.content !== "string" || !entry.content.trim()) {
        return NextResponse.json(
          { error: `Entry at index ${i}: content is required` },
          { status: 400 }
        );
      }
    }

    const data = entries.map((entry: ImportEntry) => ({
      departmentId,
      type: entry.type,
      title: entry.title.trim(),
      content: entry.content.trim(),
    }));

    const result = await (db.knowledgeBase.createMany as Function)({
      data,
      skipDuplicates: false,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "knowledge_base.bulk_import",
      entityType: "KnowledgeBase",
      entityId: departmentId,
      newValue: { departmentId, count: result.count },
    });

    return NextResponse.json({ imported: result.count }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/knowledge-base/import error:", error);
    return NextResponse.json({ error: "Failed to import knowledge base entries" }, { status: 500 });
  }
}
