import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export interface UploadResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
}

export interface UploadError {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_TYPE" | "NO_FILE" | "SAVE_ERROR";
}

/**
 * Validate and save an uploaded file to disk.
 * Files are stored at: /uploads/{tenantId}/{leadId}/{uuid}{ext}
 */
export async function processUpload(
  file: File,
  tenantId: string,
  leadId: string
): Promise<UploadResult | UploadError> {
  if (!file || file.size === 0) {
    return { error: "No file provided", code: "NO_FILE" };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      code: "FILE_TOO_LARGE",
    };
  }

  const ext = ALLOWED_MIME_TYPES[file.type];
  if (!ext) {
    return {
      error: `File type "${file.type}" is not allowed. Allowed: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX.`,
      code: "INVALID_TYPE",
    };
  }

  const fileId = randomUUID();
  const safeFileName = `${fileId}${ext}`;
  const uploadDir = path.join(process.cwd(), "uploads", tenantId, leadId);
  const filePath = path.join(uploadDir, safeFileName);
  // Store relative path for portability
  const relativePath = path.posix.join("uploads", tenantId, leadId, safeFileName);

  try {
    await fs.mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    return {
      id: fileId,
      fileName: file.name,
      filePath: relativePath,
      fileType: file.type,
      fileSize: file.size,
    };
  } catch (err) {
    console.error("[Upload] Failed to save file:", err);
    return { error: "Failed to save file to disk", code: "SAVE_ERROR" };
  }
}

/**
 * Delete a file from disk given its relative path.
 */
export async function deleteUploadedFile(relativePath: string): Promise<boolean> {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file from disk and return it as a buffer with its MIME type.
 */
export async function readUploadedFile(
  relativePath: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    const buffer = await fs.readFile(fullPath);
    const extension = path.extname(fullPath).toLowerCase();
    const mimeType = Object.entries(ALLOWED_MIME_TYPES).find(
      ([, ext]) => ext === extension
    )?.[0] || "application/octet-stream";
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export function isUploadError(result: UploadResult | UploadError): result is UploadError {
  return "error" in result;
}
