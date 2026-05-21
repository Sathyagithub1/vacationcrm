import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import {
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
} from "@/modules/conversations/canned-responses.service";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/canned-responses — list canned responses
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;
    const departmentId = searchParams.get("departmentId") || undefined;

    const responses = await listCannedResponses(db, departmentId);
    return NextResponse.json({ responses });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/canned-responses error:", error);
    return NextResponse.json({ error: "Failed to fetch canned responses" }, { status: 500 });
  }
}

// POST /api/canned-responses — create
export async function POST(request: Request) {
  try {
    const { user, db } = await requirePermission("conversations:view");

    const body = await request.json();
    const { title, content, shortcut, departmentId } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (!shortcut || typeof shortcut !== "string" || !shortcut.trim()) {
      return NextResponse.json({ error: "Shortcut is required" }, { status: 400 });
    }

    const response = await createCannedResponse(db, {
      title: title.trim(),
      content: content.trim(),
      shortcut: shortcut.trim(),
      departmentId: departmentId || null,
      createdBy: user.id,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "canned_response.create",
      entityType: "CannedResponse",
      entityId: response.id,
      newValue: response,
    });

    return NextResponse.json({ response }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Department not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("POST /api/canned-responses error:", error);
    return NextResponse.json({ error: "Failed to create canned response" }, { status: 500 });
  }
}

// PUT /api/canned-responses — update (pass id in body)
export async function PUT(request: Request) {
  try {
    const { user, db } = await requirePermission("conversations:view");

    const body = await request.json();
    const { id, ...data } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Canned response ID is required" }, { status: 400 });
    }

    const response = await updateCannedResponse(db, id, data);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "canned_response.update",
      entityType: "CannedResponse",
      entityId: id,
      newValue: response,
    });

    return NextResponse.json({ response });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Canned response not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("PUT /api/canned-responses error:", error);
    return NextResponse.json({ error: "Failed to update canned response" }, { status: 500 });
  }
}

// DELETE /api/canned-responses — delete (pass id in body)
export async function DELETE(request: Request) {
  try {
    const { user, db } = await requirePermission("conversations:view");

    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Canned response ID is required" }, { status: 400 });
    }

    const deleted = await deleteCannedResponse(db, id);

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "canned_response.delete",
      entityType: "CannedResponse",
      entityId: id,
      oldValue: deleted,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
      if (error.message === "Canned response not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
    }
    console.error("DELETE /api/canned-responses error:", error);
    return NextResponse.json({ error: "Failed to delete canned response" }, { status: 500 });
  }
}
