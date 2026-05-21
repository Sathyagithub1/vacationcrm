import { prisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export interface CreateBroadcastData {
  tenantId: string;
  createdBy: string;
  title: string;
  content: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";
  targetType: "ALL_CUSTOMERS" | "DEPARTMENT" | "STAGE" | "CUSTOM_FILTER";
  targetFilter?: Record<string, unknown> | null;
  scheduledAt?: string | null;
}

/**
 * Create a draft broadcast
 */
export async function createBroadcast(data: CreateBroadcastData) {
  const broadcast = await prisma.broadcast.create({
    data: {
      tenantId: data.tenantId,
      createdBy: data.createdBy,
      title: data.title,
      content: data.content,
      channel: data.channel,
      targetType: data.targetType,
      targetFilter: (data.targetFilter || {}) as any,
      status: "DRAFT",
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    },
  });

  return broadcast;
}

/**
 * Update a draft broadcast
 */
export async function updateBroadcast(
  db: TenantDb,
  broadcastId: string,
  data: Partial<Pick<CreateBroadcastData, "title" | "content" | "channel" | "targetType" | "targetFilter" | "scheduledAt">>
) {
  const existing = await db.broadcast.findFirst({ where: { id: broadcastId } });
  if (!existing) throw new Error("Broadcast not found");
  if (existing.status !== "DRAFT") throw new Error("Can only edit draft broadcasts");

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.channel !== undefined) updateData.channel = data.channel;
  if (data.targetType !== undefined) updateData.targetType = data.targetType;
  if (data.targetFilter !== undefined) updateData.targetFilter = data.targetFilter || {};
  if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;

  return db.broadcast.update({
    where: { id: broadcastId },
    data: updateData,
  });
}

/**
 * Get recipients for a broadcast based on its target filter
 */
export async function getRecipients(
  db: TenantDb,
  targetType: string,
  targetFilter: Record<string, unknown> | null
) {
  const customerWhere: Record<string, unknown> = {};

  switch (targetType) {
    case "ALL_CUSTOMERS":
      break;

    case "DEPARTMENT": {
      const deptId = targetFilter?.departmentId as string;
      if (!deptId) throw new Error("Department ID required for DEPARTMENT target");
      // Get customers who have leads in this department
      const leads = await db.lead.findMany({
        where: { departmentId: deptId },
        select: { customerId: true },
        distinct: ["customerId"],
      });
      const customerIds = leads.map((l: { customerId: string }) => l.customerId);
      if (customerIds.length === 0) return [];
      customerWhere.id = { in: customerIds };
      break;
    }

    case "STAGE": {
      const stageId = targetFilter?.stageId as string;
      if (!stageId) throw new Error("Stage ID required for STAGE target");
      const leads = await db.lead.findMany({
        where: { stageId },
        select: { customerId: true },
        distinct: ["customerId"],
      });
      const customerIds = leads.map((l: { customerId: string }) => l.customerId);
      if (customerIds.length === 0) return [];
      customerWhere.id = { in: customerIds };
      break;
    }

    case "CUSTOM_FILTER":
      // Custom filter could contain customer IDs directly
      if (targetFilter?.customerIds && Array.isArray(targetFilter.customerIds)) {
        customerWhere.id = { in: targetFilter.customerIds };
      }
      break;
  }

  return db.customer.findMany({
    where: customerWhere,
    select: { id: true, name: true, email: true, mobile: true },
  });
}

/**
 * Initiate sending: create recipient records, update status
 */
export async function initiateSend(db: TenantDb, broadcastId: string) {
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId } });
  if (!broadcast) throw new Error("Broadcast not found");
  if (broadcast.status !== "DRAFT" && broadcast.status !== "SCHEDULED") {
    throw new Error("Broadcast must be in DRAFT or SCHEDULED status to send");
  }

  const recipients = await getRecipients(
    db,
    broadcast.targetType,
    broadcast.targetFilter as Record<string, unknown> | null
  );

  if (recipients.length === 0) {
    throw new Error("No recipients found for this broadcast target");
  }

  // Create recipient records
  await prisma.broadcastRecipient.createMany({
    data: recipients.map((r: { id: string }) => ({
      broadcastId: broadcast.id,
      customerId: r.id,
      status: "PENDING",
    })),
  });

  // Update broadcast status
  await db.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: "SENDING",
      totalRecipients: recipients.length,
      sentAt: new Date(),
    },
  });

  return { recipientCount: recipients.length };
}

/**
 * Get broadcast detail with stats
 */
export async function getDetail(db: TenantDb, broadcastId: string) {
  const broadcast = await db.broadcast.findFirst({
    where: { id: broadcastId },
    include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  if (!broadcast) throw new Error("Broadcast not found");
  return broadcast;
}

/**
 * Schedule a broadcast for later
 */
export async function scheduleBroadcast(db: TenantDb, broadcastId: string, scheduledAt: string) {
  const broadcast = await db.broadcast.findFirst({ where: { id: broadcastId } });
  if (!broadcast) throw new Error("Broadcast not found");
  if (broadcast.status !== "DRAFT") throw new Error("Can only schedule draft broadcasts");

  return db.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: "SCHEDULED",
      scheduledAt: new Date(scheduledAt),
    },
  });
}
