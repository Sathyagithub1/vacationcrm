import { findOrCreateCustomer, updateCustomerStats } from "@/modules/customers/customers.service";
import { addFollowUpRulesJob } from "@/lib/queue";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface CreateLeadData {
  customerName: string;
  customerMobile: string;
  customerEmail?: string | null;
  departmentId: string;
  destination?: string | null;
  travelDate?: string | null;
  numPassengers?: number | null;
  specialRequirement?: string | null;
  source?: string;
  priority?: string;
  assignedTo?: string | null;
  isFutureInterest?: boolean;
  tenantId: string;
}

interface UpdateLeadData {
  destination?: string | null;
  travelDate?: string | null;
  numPassengers?: number | null;
  specialRequirement?: string | null;
  source?: string;
  priority?: string;
  isFutureInterest?: boolean;
  departmentId?: string;
}

export async function createLead(db: TenantDb, data: CreateLeadData, userId: string) {
  return await (db.$transaction as Function)(async (tx: TenantDb) => {
    // Find or create the customer
    const customer = await findOrCreateCustomer(tx, {
      name: data.customerName,
      mobile: data.customerMobile,
      email: data.customerEmail || null,
      tenantId: data.tenantId,
    });

    // Get default stage for the department (or tenant default)
    let defaultStage = await tx.pipelineStage.findFirst({
      where: { departmentId: data.departmentId, isDefault: true },
      orderBy: { position: "asc" },
    });

    if (!defaultStage) {
      defaultStage = await tx.pipelineStage.findFirst({
        where: { isDefault: true },
        orderBy: { position: "asc" },
      });
    }

    if (!defaultStage) {
      defaultStage = await tx.pipelineStage.findFirst({
        orderBy: { position: "asc" },
      });
    }

    if (!defaultStage) {
      throw new Error("No pipeline stages configured. Please create pipeline stages first.");
    }

    const lead = await (tx.lead.create as Function)({
      data: {
        departmentId: data.departmentId,
        customerId: customer.id,
        destination: data.destination || null,
        travelDate: data.travelDate ? new Date(data.travelDate) : null,
        numPassengers: data.numPassengers || null,
        specialRequirement: data.specialRequirement || null,
        source: data.source || "MANUAL",
        stageId: defaultStage.id,
        assignedTo: data.assignedTo || null,
        priority: data.priority || "MEDIUM",
        isFutureInterest: data.isFutureInterest || false,
      },
    });

    // Create SYSTEM activity "Lead created"
    await (tx.leadActivity.create as Function)({
      data: {
        leadId: lead.id,
        userId,
        type: "SYSTEM",
        content: { message: "Lead created" },
      },
    });

    // Update customer stats
    await updateCustomerStats(tx, customer.id);

    return lead;
  });
}

export async function updateLead(db: TenantDb, leadId: string, data: UpdateLeadData, userId: string) {
  const existing = await db.lead.findFirst({ where: { id: leadId } });
  if (!existing) throw new Error("Lead not found");

  const updateData: Record<string, unknown> = {};
  if (data.destination !== undefined) updateData.destination = data.destination;
  if (data.travelDate !== undefined) updateData.travelDate = data.travelDate ? new Date(data.travelDate) : null;
  if (data.numPassengers !== undefined) updateData.numPassengers = data.numPassengers;
  if (data.specialRequirement !== undefined) updateData.specialRequirement = data.specialRequirement;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.isFutureInterest !== undefined) updateData.isFutureInterest = data.isFutureInterest;
  if (data.departmentId !== undefined) updateData.departmentId = data.departmentId;

  const lead = await db.lead.update({
    where: { id: leadId },
    data: updateData,
  });

  // Create activity for update
  const changedFields = Object.keys(updateData);
  if (changedFields.length > 0) {
    await (db.leadActivity.create as Function)({
      data: {
        leadId: lead.id,
        userId,
        type: "SYSTEM",
        content: { message: `Updated: ${changedFields.join(", ")}` },
      },
    });
  }

  return lead;
}

export async function changeStage(db: TenantDb, leadId: string, newStageId: string, userId: string) {
  const existing = await db.lead.findFirst({
    where: { id: leadId },
    include: { stage: { select: { id: true, name: true } } },
  });
  if (!existing) throw new Error("Lead not found");

  const newStage = await db.pipelineStage.findFirst({ where: { id: newStageId } });
  if (!newStage) throw new Error("Stage not found");

  if (existing.stageId === newStageId) return existing;

  const lead = await db.lead.update({
    where: { id: leadId },
    data: { stageId: newStageId },
  });

  // Create STAGE_CHANGE activity
  await (db.leadActivity.create as Function)({
    data: {
      leadId: lead.id,
      userId,
      type: "STAGE_CHANGE",
      content: {
        from: { id: existing.stage.id, name: existing.stage.name },
        to: { id: newStage.id, name: newStage.name },
      },
    },
  });

  // Enqueue follow-up rules evaluation for the stage change
  await addFollowUpRulesJob({
    leadId,
    tenantId: existing.tenantId,
    stageSlug: newStage.slug,
    assignedTo: existing.assignedTo || userId,
  });

  return lead;
}

export async function addNote(db: TenantDb, leadId: string, content: string, userId: string) {
  const existing = await db.lead.findFirst({ where: { id: leadId } });
  if (!existing) throw new Error("Lead not found");

  const activity = await (db.leadActivity.create as Function)({
    data: {
      leadId,
      userId,
      type: "NOTE",
      content: { text: content },
    },
  });

  return activity;
}

export async function deleteLead(db: TenantDb, leadId: string) {
  const existing = await db.lead.findFirst({ where: { id: leadId } });
  if (!existing) throw new Error("Lead not found");

  // Hard delete (cascades to activities, follow-ups, etc.)
  await db.lead.delete({ where: { id: leadId } });

  // Update customer stats
  await updateCustomerStats(db, existing.customerId);

  return existing;
}
