type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateFollowUpData {
  leadId: string;
  assignedTo: string;
  type: string;
  scheduledAt: string;
  messageTemplate?: string | null;
}

interface ListFollowUpsParams {
  status?: string;
  type?: string;
  assignedTo?: string;
  page?: number;
  limit?: number;
}

export async function createFollowUp(db: TenantDb, data: CreateFollowUpData) {
  // Verify lead exists
  const lead = await db.lead.findFirst({ where: { id: data.leadId } });
  if (!lead) throw new Error("Lead not found");

  // Verify assignee exists
  const assignee = await db.user.findFirst({ where: { id: data.assignedTo, isActive: true } });
  if (!assignee) throw new Error("Assignee not found");

  const followUp = await (db.followUp.create as Function)({
    data: {
      leadId: data.leadId,
      assignedTo: data.assignedTo,
      type: data.type,
      scheduledAt: new Date(data.scheduledAt),
      messageTemplate: data.messageTemplate || null,
      status: "PENDING",
    },
  });

  return followUp;
}

export async function listFollowUps(db: TenantDb, params: ListFollowUpsParams) {
  const { status, type, assignedTo, page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (assignedTo) where.assignedTo = assignedTo;

  const [followUps, total] = await Promise.all([
    db.followUp.findMany({
      where,
      orderBy: [
        { status: "asc" }, // PENDING first
        { scheduledAt: "asc" }, // earliest first
      ],
      skip,
      take: limit,
      include: {
        lead: {
          include: {
            customer: { select: { id: true, name: true, mobile: true } },
            department: { select: { id: true, name: true, color: true } },
          },
        },
        assignee: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
    db.followUp.count({ where }),
  ]);

  return { followUps, total, page, totalPages: Math.ceil(total / limit) };
}

export async function markComplete(db: TenantDb, followUpId: string) {
  const existing = await db.followUp.findFirst({ where: { id: followUpId } });
  if (!existing) throw new Error("Follow-up not found");
  if (existing.status === "COMPLETED") throw new Error("Already completed");

  const followUp = await db.followUp.update({
    where: { id: followUpId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  return followUp;
}

export async function snoozeFollowUp(db: TenantDb, followUpId: string, newScheduledAt: string) {
  const existing = await db.followUp.findFirst({ where: { id: followUpId } });
  if (!existing) throw new Error("Follow-up not found");
  if (existing.status === "COMPLETED") throw new Error("Cannot snooze a completed follow-up");

  const followUp = await db.followUp.update({
    where: { id: followUpId },
    data: {
      scheduledAt: new Date(newScheduledAt),
      status: "PENDING",
    },
  });

  return followUp;
}

export async function reassignFollowUp(db: TenantDb, followUpId: string, newAssignee: string) {
  const existing = await db.followUp.findFirst({ where: { id: followUpId } });
  if (!existing) throw new Error("Follow-up not found");

  // Verify new assignee exists
  const user = await db.user.findFirst({ where: { id: newAssignee, isActive: true } });
  if (!user) throw new Error("Assignee not found");

  const followUp = await db.followUp.update({
    where: { id: followUpId },
    data: { assignedTo: newAssignee },
  });

  return followUp;
}

export async function cancelFollowUp(db: TenantDb, followUpId: string) {
  const existing = await db.followUp.findFirst({ where: { id: followUpId } });
  if (!existing) throw new Error("Follow-up not found");

  const followUp = await db.followUp.update({
    where: { id: followUpId },
    data: { status: "CANCELLED" },
  });

  return followUp;
}
