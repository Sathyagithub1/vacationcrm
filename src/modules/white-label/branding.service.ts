import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/prisma";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * Ensure the branding upload directory exists for a tenant.
 */
function ensureBrandingDir(tenantId: string): string {
  const dir = path.join(UPLOADS_ROOT, tenantId, "branding");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save an uploaded file (logo, favicon, loginBg) to disk.
 * Returns the public URL path.
 */
export async function saveBrandingFile(
  tenantId: string,
  fileType: "logo" | "favicon" | "loginBg",
  buffer: Buffer,
  originalName: string
): Promise<string> {
  const dir = ensureBrandingDir(tenantId);

  // Determine extension
  const ext = path.extname(originalName) || ".png";
  const filename = `${fileType}${ext}`;
  const filePath = path.join(dir, filename);

  // Write file
  fs.writeFileSync(filePath, buffer);

  // Return public URL
  const publicUrl = `/uploads/${tenantId}/branding/${filename}`;

  // Update tenant record
  const updateData: Record<string, string> = {};
  if (fileType === "logo") updateData.logoUrl = publicUrl;
  if (fileType === "favicon") updateData.faviconUrl = publicUrl;
  if (fileType === "loginBg") updateData.loginBgUrl = publicUrl;

  await prisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
  });

  return publicUrl;
}

/**
 * Update the product name for a tenant.
 */
export async function updateProductName(
  tenantId: string,
  productName: string
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { productName },
  });
}

/**
 * Get current branding for a tenant.
 */
export async function getTenantBranding(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      faviconUrl: true,
      productName: true,
      themeConfig: true,
      loginBgUrl: true,
      address: true,
      timezone: true,
      currency: true,
    },
  });

  return tenant;
}
