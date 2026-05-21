import { prisma } from "@/lib/prisma";

interface ReportFilters {
  tenantId: string;
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
}

function buildDateFilter(dateFrom?: string, dateTo?: string) {
  const filter: Record<string, unknown> = {};
  if (dateFrom) filter.gte = new Date(dateFrom);
  if (dateTo) filter.lte = new Date(dateTo);
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// ─── Lead Funnel ────────────────────────────────────────────────────────────

export async function getLeadFunnel(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo, departmentId } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  if (departmentId) where.departmentId = departmentId;
  if (dateFilter) where.createdAt = dateFilter;

  const stages = await prisma.pipelineStage.findMany({
    where: { tenantId },
    orderBy: { position: "asc" },
  });

  const counts = await prisma.lead.groupBy({
    by: ["stageId"],
    where,
    _count: { id: true },
  });

  const totalLeads = counts.reduce((sum, c) => sum + c._count.id, 0);
  const countMap = Object.fromEntries(counts.map((c) => [c.stageId, c._count.id]));

  return {
    summary: { totalLeads },
    rows: stages.map((stage) => {
      const count = countMap[stage.id] || 0;
      const percentage = totalLeads > 0 ? Math.round((count / totalLeads) * 10000) / 100 : 0;
      return {
        stage: stage.name,
        stageColor: stage.color,
        count,
        percentage,
      };
    }),
  };
}

// ─── Department Performance ─────────────────────────────────────────────────

export async function getDepartmentPerformance(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  if (dateFilter) where.createdAt = dateFilter;

  const departments = await prisma.department.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  });

  const leadCounts = await prisma.lead.groupBy({
    by: ["departmentId"],
    where,
    _count: { id: true },
  });

  const convertedStage = await prisma.pipelineStage.findFirst({
    where: { tenantId, slug: { in: ["converted", "won", "closed-won"] } },
  });

  let convertedCounts: { departmentId: string; _count: { id: number } }[] = [];
  if (convertedStage) {
    convertedCounts = await (prisma.lead.groupBy as any)({
      by: ["departmentId"],
      where: { ...where, stageId: convertedStage.id },
      _count: { id: true },
    });
  }

  // Average response time per department
  const leadMap = Object.fromEntries(leadCounts.map((c) => [c.departmentId, c._count.id]));
  const convMap = Object.fromEntries(convertedCounts.map((c) => [c.departmentId, c._count.id]));

  const rows = [];
  for (const dept of departments) {
    const leads = leadMap[dept.id] || 0;
    const converted = convMap[dept.id] || 0;
    const convRate = leads > 0 ? Math.round((converted / leads) * 10000) / 100 : 0;

    // Compute avg response time for this department
    const deptLeads = await prisma.lead.findMany({
      where: { tenantId, departmentId: dept.id, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      select: { id: true, createdAt: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });

    let avgResponseHours = 0;
    if (deptLeads.length > 0) {
      const leadIds = deptLeads.map((l) => l.id);
      const firstActivities = await prisma.leadActivity.findMany({
        where: { tenantId, leadId: { in: leadIds }, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "asc" },
        distinct: ["leadId"],
        select: { leadId: true, createdAt: true },
      });

      const leadCreateMap = Object.fromEntries(deptLeads.map((l) => [l.id, l.createdAt]));
      let totalHours = 0;
      let count = 0;
      for (const act of firstActivities) {
        const created = leadCreateMap[act.leadId];
        if (created) {
          totalHours += (act.createdAt.getTime() - created.getTime()) / 3600000;
          count++;
        }
      }
      avgResponseHours = count > 0 ? Math.round((totalHours / count) * 10) / 10 : 0;
    }

    rows.push({
      department: dept.name,
      totalLeads: leads,
      converted,
      conversionRate: convRate,
      avgResponseTime: avgResponseHours,
    });
  }

  return { rows };
}

// ─── Agent Performance ──────────────────────────────────────────────────────

export async function getAgentPerformance(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo, departmentId } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const agentWhere: Record<string, unknown> = {
    tenantId,
    role: { in: ["AGENT", "DEPT_MANAGER"] },
    isActive: true,
  };
  if (departmentId) agentWhere.departmentId = departmentId;

  const agents = await prisma.user.findMany({
    where: agentWhere,
    select: { id: true, name: true },
  });

  const leadWhere: Record<string, unknown> = { tenantId, assignedTo: { not: null } };
  if (departmentId) leadWhere.departmentId = departmentId;
  if (dateFilter) leadWhere.createdAt = dateFilter;

  const leadCounts = await prisma.lead.groupBy({
    by: ["assignedTo"],
    where: leadWhere,
    _count: { id: true },
  });

  const convertedStage = await prisma.pipelineStage.findFirst({
    where: { tenantId, slug: { in: ["converted", "won", "closed-won"] } },
  });

  let convertedCounts: { assignedTo: string | null; _count: { id: number } }[] = [];
  if (convertedStage) {
    convertedCounts = await (prisma.lead.groupBy as any)({
      by: ["assignedTo"],
      where: { ...leadWhere, stageId: convertedStage.id },
      _count: { id: true },
    });
  }

  const leadMap = Object.fromEntries(leadCounts.map((c) => [c.assignedTo, c._count.id]));
  const convMap = Object.fromEntries(convertedCounts.map((c) => [c.assignedTo, c._count.id]));

  const rows = agents.map((agent) => {
    const leads = leadMap[agent.id] || 0;
    const converted = convMap[agent.id] || 0;
    const convRate = leads > 0 ? Math.round((converted / leads) * 10000) / 100 : 0;
    return {
      agent: agent.name,
      leadsAssigned: leads,
      converted,
      conversionRate: convRate,
    };
  });

  return { rows };
}

// ─── Source Analysis ────────────────────────────────────────────────────────

export async function getSourceAnalysis(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo, departmentId } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  if (departmentId) where.departmentId = departmentId;
  if (dateFilter) where.createdAt = dateFilter;

  const counts = await prisma.lead.groupBy({
    by: ["source"],
    where,
    _count: { id: true },
  });

  const convertedStage = await prisma.pipelineStage.findFirst({
    where: { tenantId, slug: { in: ["converted", "won", "closed-won"] } },
  });

  let convertedCounts: { source: string; _count: { id: number } }[] = [];
  if (convertedStage) {
    convertedCounts = await (prisma.lead.groupBy as any)({
      by: ["source"],
      where: { ...where, stageId: convertedStage.id },
      _count: { id: true },
    });
  }

  const convMap = Object.fromEntries(convertedCounts.map((c) => [c.source, c._count.id]));

  const rows = counts.map((c) => {
    const total = c._count.id;
    const converted = convMap[c.source] || 0;
    return {
      source: c.source,
      leadCount: total,
      converted,
      conversionRate: total > 0 ? Math.round((converted / total) * 10000) / 100 : 0,
    };
  });

  return { rows };
}

// ─── Follow-up Effectiveness ────────────────────────────────────────────────

export async function getFollowUpEffectiveness(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const baseWhere: Record<string, unknown> = { tenantId };
  if (dateFilter) baseWhere.createdAt = dateFilter;

  const totalFollowUps = await prisma.followUp.count({ where: baseWhere });
  const completedFollowUps = await prisma.followUp.count({
    where: { ...baseWhere, status: "COMPLETED" },
  });
  const pendingFollowUps = await prisma.followUp.count({
    where: { ...baseWhere, status: "PENDING" },
  });

  const completionRate = totalFollowUps > 0
    ? Math.round((completedFollowUps / totalFollowUps) * 10000) / 100
    : 0;

  // Follow-ups by type
  const byType = await prisma.followUp.groupBy({
    by: ["type"],
    where: baseWhere,
    _count: { id: true },
  });

  const completedByType = await prisma.followUp.groupBy({
    by: ["type"],
    where: { ...baseWhere, status: "COMPLETED" },
    _count: { id: true },
  });

  const compMap = Object.fromEntries(completedByType.map((c) => [c.type, c._count.id]));

  const rows = byType.map((t) => ({
    type: t.type,
    total: t._count.id,
    completed: compMap[t.type] || 0,
    completionRate: t._count.id > 0
      ? Math.round(((compMap[t.type] || 0) / t._count.id) * 10000) / 100
      : 0,
  }));

  return {
    summary: {
      totalFollowUps,
      completedFollowUps,
      pendingFollowUps,
      completionRate,
    },
    rows,
  };
}

// ─── Time Trends ────────────────────────────────────────────────────────────

export async function getTimeTrends(filters: ReportFilters & { granularity?: string }) {
  const { tenantId, dateFrom, dateTo, departmentId, granularity = "daily" } = filters;

  // Default to last 30 days if no date range
  const effectiveFrom = dateFrom
    ? new Date(dateFrom)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const effectiveTo = dateTo ? new Date(dateTo) : new Date();

  const where: Record<string, unknown> = {
    tenantId,
    createdAt: { gte: effectiveFrom, lte: effectiveTo },
  };
  if (departmentId) where.departmentId = departmentId;

  const leads = await prisma.lead.findMany({
    where,
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const buckets: Record<string, number> = {};

  for (const lead of leads) {
    let key: string;
    const d = lead.createdAt;

    if (granularity === "monthly") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (granularity === "weekly") {
      // ISO week: get Monday of the week
      const monday = new Date(d);
      const day = monday.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      monday.setDate(monday.getDate() + diff);
      key = monday.toISOString().split("T")[0];
    } else {
      key = d.toISOString().split("T")[0];
    }

    buckets[key] = (buckets[key] || 0) + 1;
  }

  const rows = Object.entries(buckets).map(([period, count]) => ({
    period,
    count,
  }));

  return { granularity, rows };
}

// ─── CSV Generation ─────────────────────────────────────────────────────────

export function generateCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const csvHeaders = headers.join(",");
  const csvRows = rows.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = String(val);
      // Escape quotes and wrap in quotes if contains comma/quote/newline
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(",")
  );

  return [csvHeaders, ...csvRows].join("\n");
}
