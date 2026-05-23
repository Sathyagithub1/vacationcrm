import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversionStatInput {
  tenantId: string;
  dimension: "DEPARTMENT" | "SOURCE" | "AGENT" | "STAGE";
  dimensionValue: string;
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
  avgTimeToConvert: number | null;
  avgMessages: number | null;
  periodStart: Date;
  periodEnd: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONVERTED_SLUGS = ["converted", "won", "closed-won"];

async function findConvertedStageIds(db: TenantDb, tenantId: string): Promise<string[]> {
  const stages = await db.pipelineStage.findMany({
    where: { tenantId, slug: { in: CONVERTED_SLUGS } },
    select: { id: true },
  });
  return stages.map((s) => s.id);
}

/**
 * Given a list of lead IDs, compute the average time (in hours) from lead
 * creation to first stage-change activity of type STAGE_CHANGE.
 */
async function computeAvgTimeToConvert(
  db: TenantDb,
  leadIds: string[]
): Promise<number | null> {
  if (leadIds.length === 0) return null;

  const leads = await db.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, createdAt: true },
  });

  if (leads.length === 0) return null;

  const leadCreateMap = Object.fromEntries(leads.map((l) => [l.id, l.createdAt]));

  // Find the first STAGE_CHANGE activity per lead (proxy for conversion event)
  const firstChanges = await db.leadActivity.findMany({
    where: {
      leadId: { in: leadIds },
      type: "STAGE_CHANGE",
    },
    orderBy: { createdAt: "asc" },
    distinct: ["leadId"],
    select: { leadId: true, createdAt: true },
  });

  let totalHours = 0;
  let count = 0;
  for (const change of firstChanges) {
    const created = leadCreateMap[change.leadId];
    if (created) {
      totalHours += (change.createdAt.getTime() - created.getTime()) / 3_600_000;
      count++;
    }
  }

  return count > 0 ? Math.round((totalHours / count) * 10) / 10 : null;
}

/**
 * Compute avg messages per lead for a given set of lead IDs.
 * Counts all non-SYSTEM activities as messages.
 */
async function computeAvgMessages(db: TenantDb, leadIds: string[]): Promise<number | null> {
  if (leadIds.length === 0) return null;

  const counts = await db.leadActivity.groupBy({
    by: ["leadId"],
    where: {
      leadId: { in: leadIds },
      type: { not: "SYSTEM" },
    },
    _count: { id: true },
  });

  if (counts.length === 0) return null;

  const total = counts.reduce((sum, c) => sum + c._count.id, 0);
  return Math.round((total / leadIds.length) * 10) / 10;
}

// ─── Upsert Stat ─────────────────────────────────────────────────────────────

async function upsertConversionStat(db: TenantDb, stat: ConversionStatInput): Promise<void> {
  // ConversionStat has no unique constraint on (tenantId, dimension, dimensionValue)
  // so we do a findFirst + update-or-create pattern
  const existing = await (db.conversionStat as any).findFirst({
    where: {
      tenantId: stat.tenantId,
      dimension: stat.dimension,
      dimensionValue: stat.dimensionValue,
    },
    select: { id: true },
  });

  if (existing) {
    await (db.conversionStat as any).update({
      where: { id: existing.id },
      data: {
        totalLeads: stat.totalLeads,
        convertedLeads: stat.convertedLeads,
        conversionRate: stat.conversionRate,
        avgTimeToConvert: stat.avgTimeToConvert,
        avgMessages: stat.avgMessages,
        periodStart: stat.periodStart,
        periodEnd: stat.periodEnd,
        computedAt: new Date(),
      },
    });
  } else {
    await (db.conversionStat as any).create({
      data: {
        tenantId: stat.tenantId,
        dimension: stat.dimension,
        dimensionValue: stat.dimensionValue,
        totalLeads: stat.totalLeads,
        convertedLeads: stat.convertedLeads,
        conversionRate: stat.conversionRate,
        avgTimeToConvert: stat.avgTimeToConvert,
        avgMessages: stat.avgMessages,
        periodStart: stat.periodStart,
        periodEnd: stat.periodEnd,
        computedAt: new Date(),
      },
    });
  }
}

// ─── Main: Refresh Conversion Stats ──────────────────────────────────────────

export async function refreshConversionStats(
  db: TenantDb,
  tenantId: string
): Promise<{ refreshed: number }> {
  const now = new Date();
  // Use full historical window: tenant's inception to now
  const periodStart = new Date(0); // epoch — all-time
  const periodEnd = now;

  const convertedStageIds = await findConvertedStageIds(db, tenantId);

  let refreshed = 0;

  // ── DEPARTMENT dimension ────────────────────────────────────────────────────

  const departments = await db.department.findMany({
    where: { tenantId, isActive: true },
    select: { id: true },
  });

  for (const dept of departments) {
    const allLeads = await db.lead.findMany({
      where: { tenantId, departmentId: dept.id },
      select: { id: true },
    });

    const allIds = allLeads.map((l) => l.id);
    const totalLeads = allIds.length;

    const convertedLeads =
      convertedStageIds.length > 0
        ? await db.lead.count({
            where: { tenantId, departmentId: dept.id, stageId: { in: convertedStageIds } },
          })
        : 0;

    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 10000) / 100 : 0;

    const convertedIds = (
      await db.lead.findMany({
        where: { tenantId, departmentId: dept.id, stageId: { in: convertedStageIds } },
        select: { id: true },
      })
    ).map((l) => l.id);

    const [avgTimeToConvert, avgMessages] = await Promise.all([
      computeAvgTimeToConvert(db, convertedIds),
      computeAvgMessages(db, allIds),
    ]);

    await upsertConversionStat(db, {
      tenantId,
      dimension: "DEPARTMENT",
      dimensionValue: dept.id,
      totalLeads,
      convertedLeads,
      conversionRate,
      avgTimeToConvert,
      avgMessages,
      periodStart,
      periodEnd,
    });

    refreshed++;
  }

  // ── SOURCE dimension ────────────────────────────────────────────────────────

  const sourceCounts = await db.lead.groupBy({
    by: ["source"],
    where: { tenantId },
    _count: { id: true },
  });

  for (const sc of sourceCounts) {
    const totalLeads = sc._count.id;

    const convertedLeads =
      convertedStageIds.length > 0
        ? await db.lead.count({
            where: { tenantId, source: sc.source, stageId: { in: convertedStageIds } },
          })
        : 0;

    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 10000) / 100 : 0;

    const allIds = (
      await db.lead.findMany({
        where: { tenantId, source: sc.source },
        select: { id: true },
      })
    ).map((l) => l.id);

    const convertedIds = (
      await db.lead.findMany({
        where: { tenantId, source: sc.source, stageId: { in: convertedStageIds } },
        select: { id: true },
      })
    ).map((l) => l.id);

    const [avgTimeToConvert, avgMessages] = await Promise.all([
      computeAvgTimeToConvert(db, convertedIds),
      computeAvgMessages(db, allIds),
    ]);

    await upsertConversionStat(db, {
      tenantId,
      dimension: "SOURCE",
      dimensionValue: sc.source,
      totalLeads,
      convertedLeads,
      conversionRate,
      avgTimeToConvert,
      avgMessages,
      periodStart,
      periodEnd,
    });

    refreshed++;
  }

  // ── AGENT dimension ─────────────────────────────────────────────────────────

  const agentCounts = await db.lead.groupBy({
    by: ["assignedTo"],
    where: { tenantId, assignedTo: { not: null } },
    _count: { id: true },
  });

  for (const ac of agentCounts) {
    if (!ac.assignedTo) continue;

    const totalLeads = ac._count.id;

    const convertedLeads =
      convertedStageIds.length > 0
        ? await db.lead.count({
            where: { tenantId, assignedTo: ac.assignedTo, stageId: { in: convertedStageIds } },
          })
        : 0;

    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 10000) / 100 : 0;

    const allIds = (
      await db.lead.findMany({
        where: { tenantId, assignedTo: ac.assignedTo },
        select: { id: true },
      })
    ).map((l) => l.id);

    const convertedIds = (
      await db.lead.findMany({
        where: { tenantId, assignedTo: ac.assignedTo, stageId: { in: convertedStageIds } },
        select: { id: true },
      })
    ).map((l) => l.id);

    const [avgTimeToConvert, avgMessages] = await Promise.all([
      computeAvgTimeToConvert(db, convertedIds),
      computeAvgMessages(db, allIds),
    ]);

    await upsertConversionStat(db, {
      tenantId,
      dimension: "AGENT",
      dimensionValue: ac.assignedTo,
      totalLeads,
      convertedLeads,
      conversionRate,
      avgTimeToConvert,
      avgMessages,
      periodStart,
      periodEnd,
    });

    refreshed++;
  }

  // ── STAGE dimension ─────────────────────────────────────────────────────────

  const stageCounts = await db.lead.groupBy({
    by: ["stageId"],
    where: { tenantId },
    _count: { id: true },
  });

  for (const sc of stageCounts) {
    const totalLeads = sc._count.id;

    // For stage dimension, "converted" means lead is currently in a converted stage
    const isConvertedStage = convertedStageIds.includes(sc.stageId);
    const convertedLeads = isConvertedStage ? totalLeads : 0;
    const conversionRate = isConvertedStage ? 100 : 0;

    const allIds = (
      await db.lead.findMany({
        where: { tenantId, stageId: sc.stageId },
        select: { id: true },
      })
    ).map((l) => l.id);

    const [avgTimeToConvert, avgMessages] = await Promise.all([
      isConvertedStage ? computeAvgTimeToConvert(db, allIds) : Promise.resolve(null),
      computeAvgMessages(db, allIds),
    ]);

    await upsertConversionStat(db, {
      tenantId,
      dimension: "STAGE",
      dimensionValue: sc.stageId,
      totalLeads,
      convertedLeads,
      conversionRate,
      avgTimeToConvert,
      avgMessages,
      periodStart,
      periodEnd,
    });

    refreshed++;
  }

  return { refreshed };
}
