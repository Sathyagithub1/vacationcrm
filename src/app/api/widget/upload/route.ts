import { NextRequest, NextResponse } from "next/server";
import { tenantPrisma } from "@/lib/prisma";
import { extractVisitorToken } from "@/modules/widget/widget-auth.service";
import { processUpload, isUploadError } from "@/lib/uploads";

/**
 * POST /api/widget/upload
 *
 * PUBLIC route — authenticated via visitor JWT in Authorization header.
 * Accepts multipart/form-data with fields:
 *   - file          — the file to upload
 *   - conversationId — conversation to associate the file with
 *
 * Validates MIME type + extension server-side via processUpload.
 * Saves a BOT-acknowledged message referencing the file URL.
 * Returns { fileUrl, message }.
 */
export async function POST(request: NextRequest) {
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

    // ── Parse form data ───────────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");
    const conversationId = formData.get("conversationId");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!conversationId || typeof conversationId !== "string" || !conversationId.trim()) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const convId = conversationId.trim();

    // ── Verify conversation belongs to this tenant ─────────────────────────────
    const conversation = await db.conversation.findFirst({
      where: { id: convId },
      select: { id: true, status: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (conversation.status === "CLOSED") {
      return NextResponse.json({ error: "Conversation is closed" }, { status: 400 });
    }

    // ── Validate and save file ────────────────────────────────────────────────
    const result = await processUpload(file, tenantId, convId);
    if (isUploadError(result)) {
      const statusMap: Record<string, number> = {
        FILE_TOO_LARGE: 413,
        INVALID_TYPE: 415,
        NO_FILE: 400,
        SAVE_ERROR: 500,
      };
      return NextResponse.json(
        { error: result.error },
        { status: statusMap[result.code] ?? 400 }
      );
    }

    // Serve the file via the public uploads URL
    const fileUrl = `/${result.filePath}`;

    // Save customer message referencing the uploaded file
    const message = await (db.message.create as Function)({
      data: {
        conversationId: convId,
        senderType: "CUSTOMER",
        senderId: null,
        content: result.fileName,
        messageType: "FILE",
        fileUrl,
      },
    });

    return NextResponse.json({ fileUrl, message }, { status: 201 });
  } catch (error) {
    console.error("POST /api/widget/upload error:", error);
    return NextResponse.json({ error: "Failed to process upload" }, { status: 500 });
  }
}
