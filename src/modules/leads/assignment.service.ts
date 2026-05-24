import { prisma } from "@/lib/prisma";
import { createNotification } from "@/modules/notifications/notification.service";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export async function assignLead(db: TenantDb, leadId: string, agentId: string, assignedBy: string, tenantId: string) {
  const lead = await db.lead.findFirst({
    where: { id: leadId },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (!lead) throw new Error("Lead not found");

  const agent = await db.user.findFirst({ where: { id: agentId } });
  if (!agent) throw new Error("Agent not found");

  const previousAssignee = lead.assignee;

  // Update lead assignment
  const updatedLead = await db.lead.update({
    where: { id: leadId },
    data: { assignedTo: agentId },
  });

  // Create ASSIGNMENT activity
  await (db.leadActivity.create as Function)({
    data: {
      leadId,
      userId: assignedBy,
      type: "ASSIGNMENT",
      content: {
        from: previousAssignee ? { id: previousAssignee.id, name: previousAssignee.name } : null,
        to: { id: agent.id, name: agent.name },
      },
    },
  });

  // Create LEAD_ASSIGNED notification for the agent via the multi-channel dispatcher.
  // This replaces the former direct db.notification.create so that email/SMS/WA channels
  // configured by the tenant's notificationSettings are also honoured.
  await createNotification({
    tenantId,
    userId: agentId,
    type: "LEAD_ASSIGNED",
    title: "New lead assigned",
    body: `A lead has been assigned to you.`,
    data: { leadId },
  });

  return updatedLead;
}
