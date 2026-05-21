type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateEscalationData {
  leadId: string;
  conversationId?: string | null;
  reason: string;
  escalatedFrom: string;
  escalatedTo: string;
  notes?: string | null;
}

export async function createEscalation(db: TenantDb, data: CreateEscalationData) {
  // Verify lead exists
  const lead = await db.lead.findFirst({ where: { id: data.leadId } });
  if (!lead) throw new Error("Lead not found");

  // Verify escalatedTo user exists
  const toUser = await db.user.findFirst({ where: { id: data.escalatedTo, isActive: true } });
  if (!toUser) throw new Error("Target user not found");

  // Verify escalatedFrom user exists
  const fromUser = await db.user.findFirst({ where: { id: data.escalatedFrom } });
  if (!fromUser) throw new Error("Source user not found");

  // Verify conversation if provided
  if (data.conversationId) {
    const conversation = await db.conversation.findFirst({ where: { id: data.conversationId } });
    if (!conversation) throw new Error("Conversation not found");
  }

  const escalation = await (db.escalation.create as Function)({
    data: {
      leadId: data.leadId,
      conversationId: data.conversationId || null,
      reason: data.reason,
      escalatedFrom: data.escalatedFrom,
      escalatedTo: data.escalatedTo,
      notes: data.notes || null,
      status: "OPEN",
    },
  });

  return escalation;
}

export async function acknowledgeEscalation(db: TenantDb, escalationId: string) {
  const existing = await db.escalation.findFirst({ where: { id: escalationId } });
  if (!existing) throw new Error("Escalation not found");
  if (existing.status !== "OPEN") throw new Error("Can only acknowledge open escalations");

  const escalation = await db.escalation.update({
    where: { id: escalationId },
    data: { status: "ACKNOWLEDGED" },
  });

  return escalation;
}

export async function resolveEscalation(db: TenantDb, escalationId: string, notes?: string) {
  const existing = await db.escalation.findFirst({ where: { id: escalationId } });
  if (!existing) throw new Error("Escalation not found");
  if (existing.status === "RESOLVED" || existing.status === "CLOSED") {
    throw new Error("Escalation is already resolved or closed");
  }

  const updateData: Record<string, unknown> = {
    status: "RESOLVED",
    resolvedAt: new Date(),
  };
  if (notes) updateData.notes = notes;

  const escalation = await db.escalation.update({
    where: { id: escalationId },
    data: updateData,
  });

  return escalation;
}

export async function closeEscalation(db: TenantDb, escalationId: string) {
  const existing = await db.escalation.findFirst({ where: { id: escalationId } });
  if (!existing) throw new Error("Escalation not found");
  if (existing.status === "CLOSED") throw new Error("Already closed");

  const escalation = await db.escalation.update({
    where: { id: escalationId },
    data: {
      status: "CLOSED",
      resolvedAt: existing.resolvedAt || new Date(),
    },
  });

  return escalation;
}
