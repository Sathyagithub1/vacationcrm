import { prisma } from "@/lib/prisma";

interface LogAuditData {
  tenantId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAudit(data: LogAuditData) {
  return prisma.auditLog.create({
    data: {
      tenantId: data.tenantId,
      userId: data.userId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValue: data.oldValue != null ? (data.oldValue as object) : undefined,
      newValue: data.newValue != null ? (data.newValue as object) : undefined,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}
