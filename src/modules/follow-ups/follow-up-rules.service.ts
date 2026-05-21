type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateRuleData {
  departmentId?: string | null;
  triggerType: string;
  triggerValue?: string | null;
  followUpType: string;
  delayHours: number;
  messageTemplate?: string | null;
}

interface UpdateRuleData {
  departmentId?: string | null;
  triggerType?: string;
  triggerValue?: string | null;
  followUpType?: string;
  delayHours?: number;
  messageTemplate?: string | null;
  isActive?: boolean;
}

export async function listFollowUpRules(db: TenantDb) {
  const rules = await db.followUpRule.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { id: true, name: true } },
    },
  });

  return rules;
}

export async function createFollowUpRule(db: TenantDb, data: CreateRuleData) {
  // Validate department if provided
  if (data.departmentId) {
    const dept = await db.department.findFirst({ where: { id: data.departmentId } });
    if (!dept) throw new Error("Department not found");
  }

  const rule = await (db.followUpRule.create as Function)({
    data: {
      departmentId: data.departmentId || null,
      triggerType: data.triggerType,
      triggerValue: data.triggerValue || null,
      followUpType: data.followUpType,
      delayHours: data.delayHours,
      messageTemplate: data.messageTemplate || null,
      isActive: true,
    },
  });

  return rule;
}

export async function updateFollowUpRule(db: TenantDb, ruleId: string, data: UpdateRuleData) {
  const existing = await db.followUpRule.findFirst({ where: { id: ruleId } });
  if (!existing) throw new Error("Rule not found");

  const updateData: Record<string, unknown> = {};
  if (data.departmentId !== undefined) updateData.departmentId = data.departmentId || null;
  if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
  if (data.triggerValue !== undefined) updateData.triggerValue = data.triggerValue;
  if (data.followUpType !== undefined) updateData.followUpType = data.followUpType;
  if (data.delayHours !== undefined) updateData.delayHours = data.delayHours;
  if (data.messageTemplate !== undefined) updateData.messageTemplate = data.messageTemplate;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const rule = await db.followUpRule.update({
    where: { id: ruleId },
    data: updateData,
  });

  return rule;
}

export async function deleteFollowUpRule(db: TenantDb, ruleId: string) {
  const existing = await db.followUpRule.findFirst({ where: { id: ruleId } });
  if (!existing) throw new Error("Rule not found");

  await db.followUpRule.delete({ where: { id: ruleId } });
  return existing;
}
