import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import { processUpload, isUploadError } from "@/lib/uploads";
import { logAudit } from "@/modules/audit/audit.service";

// POST /api/uploads — upload a file for a lead
export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const leadId = formData.get("leadId") as string | null;

    if (!leadId) {
      return NextResponse.json({ error: "leadId is required" }, { status: 400 });
    }

    // Verify the lead exists and belongs to this tenant
    const lead = await db.lead.findFirst({ where: { id: leadId } });
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const result = await processUpload(file, user.tenantId, leadId);

    if (isUploadError(result)) {
      const statusCode = result.code === "FILE_TOO_LARGE" ? 413 : 400;
      return NextResponse.json({ error: result.error }, { status: statusCode });
    }

    // Save record to database
    const fileRecord = await db.fileUpload.create({
      data: {
        tenantId: user.tenantId,
        leadId,
        uploadedBy: user.id,
        fileName: result.fileName,
        filePath: result.filePath,
        fileType: result.fileType,
        fileSize: result.fileSize,
      },
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "file.upload",
      entityType: "FileUpload",
      entityId: fileRecord.id,
      newValue: {
        fileName: result.fileName,
        fileType: result.fileType,
        fileSize: result.fileSize,
        leadId,
      },
    });

    return NextResponse.json({ file: fileRecord }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("POST /api/uploads error:", error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}

// GET /api/uploads?leadId=xxx — list files for a lead
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();
    const { searchParams } = request.nextUrl;
    const leadId = searchParams.get("leadId");

    if (!leadId) {
      return NextResponse.json({ error: "leadId is required" }, { status: 400 });
    }

    const files = await db.fileUpload.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      include: {
        uploader: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ files });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/uploads error:", error);
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }
}
