import { NextRequest, NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { saveBrandingFile } from "@/modules/white-label/branding.service";
import { logAudit } from "@/modules/audit/audit.service";

/**
 * POST /api/tenants/branding — Upload logo, favicon, or login background.
 * Expects multipart form data with:
 *   - file: the image file
 *   - type: "logo" | "favicon" | "loginBg"
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requirePermission("settings:branding");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const fileType = formData.get("type") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!fileType || !["logo", "favicon", "loginBg"].includes(fileType)) {
      return NextResponse.json(
        { error: "Invalid type — must be logo, favicon, or loginBg" },
        { status: 400 }
      );
    }

    // Validate file type — SVG is explicitly rejected (XSS risk; no sanitiser in place)
    if (file.type === "image/svg+xml") {
      return NextResponse.json(
        { error: "SVG uploads are not supported — please use PNG, JPG, or WebP" },
        { status: 415 }
      );
    }
    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/x-icon"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type — only PNG, JPEG, WebP, ICO allowed" },
        { status: 415 }
      );
    }

    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large — max 5MB" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await saveBrandingFile(
      user.tenantId,
      fileType as "logo" | "favicon" | "loginBg",
      buffer,
      file.name
    );

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: `tenant.branding.${fileType}`,
      entityType: "Tenant",
      entityId: user.tenantId,
      newValue: { fileType, url: publicUrl },
    });

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("[Branding] Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload branding file" },
      { status: 500 }
    );
  }
}
