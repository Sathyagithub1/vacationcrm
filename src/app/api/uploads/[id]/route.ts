import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import { readUploadedFile, deleteUploadedFile } from "@/lib/uploads";
import { logAudit } from "@/modules/audit/audit.service";

// GET /api/uploads/[id] — download a file
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, db } = await requireAuth();
    const { id } = await params;

    const fileRecord = await db.fileUpload.findFirst({ where: { id } });
    if (!fileRecord) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fileData = await readUploadedFile(fileRecord.filePath);
    if (!fileData) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(fileData.buffer), {
      headers: {
        "Content-Type": fileData.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileRecord.fileName)}"`,
        "Content-Length": String(fileData.buffer.length),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/uploads/[id] error:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}

// DELETE /api/uploads/[id] — delete a file
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, db } = await requireAuth();
    const { id } = await params;

    const fileRecord = await db.fileUpload.findFirst({ where: { id } });
    if (!fileRecord) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Delete from disk
    await deleteUploadedFile(fileRecord.filePath);

    // Delete from database
    await db.fileUpload.delete({ where: { id } });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "file.delete",
      entityType: "FileUpload",
      entityId: id,
      oldValue: {
        fileName: fileRecord.fileName,
        fileType: fileRecord.fileType,
        leadId: fileRecord.leadId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("DELETE /api/uploads/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
  }
}
