import { prisma } from "@/lib/prisma";

interface ReportFilters {
  tenantId: string;
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  /**
   * RBAC scope fields injected by the route.
   * - scopedDepartmentId: when set, restrict all lead queries to this
   *   department (used for DEPT_MANAGER).
   * - scopedAssignedTo: when set, restrict all lead queries to this agent
   *   (used for AGENT).
   * These take precedence over the user-supplied `departmentId` filter.
   */
  scopedDepartmentId?: string;
  scopedAssignedTo?: string;
}

function buildDateFilter(dateFrom?: string, dateTo?: string) {
  const filter: Record<string, unknown> = {};
  if (dateFrom) filter.gte = new Date(dateFrom);
  if (dateTo) filter.lte = new Date(dateTo);
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// ─── Lead Funnel ────────────────────────────────────────────────────────────

export async function getLeadFunnel(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo, departmentId, scopedDepartmentId, scopedAssignedTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  // RBAC hard scopes take precedence over user-supplied filters
  if (scopedDepartmentId) {
    where.departmentId = scopedDepartmentId;
  } else if (departmentId) {
    where.departmentId = departmentId;
  }
  if (scopedAssignedTo) where.assignedTo = scopedAssignedTo;
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
  const { tenantId, dateFrom, dateTo, scopedDepartmentId, scopedAssignedTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  if (scopedDepartmentId) where.departmentId = scopedDepartmentId;
  if (scopedAssignedTo) where.assignedTo = scopedAssignedTo;
  if (dateFilter) where.createdAt = dateFilter;

  const deptWhere: Record<string, unknown> = { tenantId, isActive: true };
  if (scopedDepartmentId) deptWhere.id = scopedDepartmentId;

  const departments = await prisma.department.findMany({
    where: deptWhere,
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
    const deptLeadWhere: Record<string, unknown> = {
      tenantId,
      departmentId: dept.id,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };
    if (scopedAssignedTo) deptLeadWhere.assignedTo = scopedAssignedTo;
    const deptLeads = await prisma.lead.findMany({
      where: deptLeadWhere,
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
  const { tenantId, dateFrom, dateTo, departmentId, scopedDepartmentId, scopedAssignedTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const agentWhere: Record<string, unknown> = {
    tenantId,
    role: { in: ["AGENT", "DEPT_MANAGER"] },
    isActive: true,
  };
  if (scopedDepartmentId) {
    agentWhere.departmentId = scopedDepartmentId;
  } else if (departmentId) {
    agentWhere.departmentId = departmentId;
  }
  // AGENT role: only show the requesting agent's own row
  if (scopedAssignedTo) agentWhere.id = scopedAssignedTo;

  const agents = await prisma.user.findMany({
    where: agentWhere,
    select: { id: true, name: true },
  });

  const leadWhere: Record<string, unknown> = { tenantId, assignedTo: { not: null } };
  if (scopedDepartmentId) {
    leadWhere.departmentId = scopedDepartmentId;
  } else if (departmentId) {
    leadWhere.departmentId = departmentId;
  }
  if (scopedAssignedTo) leadWhere.assignedTo = scopedAssignedTo;
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
  const { tenantId, dateFrom, dateTo, departmentId, scopedDepartmentId, scopedAssignedTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const where: Record<string, unknown> = { tenantId };
  if (scopedDepartmentId) {
    where.departmentId = scopedDepartmentId;
  } else if (departmentId) {
    where.departmentId = departmentId;
  }
  if (scopedAssignedTo) where.assignedTo = scopedAssignedTo;
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
  const { tenantId, dateFrom, dateTo, scopedDepartmentId, scopedAssignedTo } = filters;
  const dateFilter = buildDateFilter(dateFrom, dateTo);

  const baseWhere: Record<string, unknown> = { tenantId };
  if (dateFilter) baseWhere.createdAt = dateFilter;
  // RBAC scoping: FollowUp has assignedTo directly; dept must go via lead relation
  if (scopedAssignedTo) baseWhere.assignedTo = scopedAssignedTo;
  if (scopedDepartmentId) baseWhere.lead = { departmentId: scopedDepartmentId };

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
  const { tenantId, dateFrom, dateTo, departmentId, scopedDepartmentId, scopedAssignedTo, granularity = "daily" } = filters;

  // Default to last 30 days if no date range
  const effectiveFrom = dateFrom
    ? new Date(dateFrom)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const effectiveTo = dateTo ? new Date(dateTo) : new Date();

  const where: Record<string, unknown> = {
    tenantId,
    createdAt: { gte: effectiveFrom, lte: effectiveTo },
  };
  if (scopedDepartmentId) {
    where.departmentId = scopedDepartmentId;
  } else if (departmentId) {
    where.departmentId = departmentId;
  }
  if (scopedAssignedTo) where.assignedTo = scopedAssignedTo;

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

// ─── Revenue ────────────────────────────────────────────────────────────────

/**
 * Revenue report from Razorpay payments.
 *
 * Money is recognised at capture time (`paidAt`) and refunds at `refundedAt`,
 * bucketed by month. Net = captured − refunded. All figures are real amounts
 * from the payments table (paise → rupees); nothing is fabricated.
 *
 * RBAC: payments have no direct department/agent column, so scoping is applied
 * through the related lead (AGENT → lead.assignedTo, DEPT_MANAGER → lead.departmentId).
 * Payments not linked to a lead are therefore excluded for scoped roles.
 */
export async function getRevenue(filters: ReportFilters) {
  const { tenantId, dateFrom, dateTo, departmentId, scopedDepartmentId, scopedAssignedTo } = filters;

  // Default to the last 12 months when no explicit range is given.
  const effectiveFrom = dateFrom
    ? new Date(dateFrom)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const effectiveTo = dateTo ? new Date(dateTo) : new Date();

  const where: Record<string, unknown> = { tenantId };
  // RBAC hard-scope through the lead relation (takes precedence over departmentId).
  if (scopedAssignedTo) {
    where.lead = { assignedTo: scopedAssignedTo };
  } else if (scopedDepartmentId) {
    where.lead = { departmentId: scopedDepartmentId };
  } else if (departmentId) {
    where.lead = { departmentId };
  }

  const payments = await prisma.payment.findMany({
    where: {
      ...where,
      OR: [
        { paidAt: { gte: effectiveFrom, lte: effectiveTo } },
        { refundedAt: { gte: effectiveFrom, lte: effectiveTo } },
      ],
    },
    select: { amountPaise: true, status: true, paidAt: true, refundedAt: true },
  });

  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const buckets: Record<string, { capturedPaise: number; refundedPaise: number; count: number }> = {};
  let totalCapturedPaise = 0;
  let totalRefundedPaise = 0;
  let capturedCount = 0;

  for (const p of payments) {
    // Captured revenue is recognised at paidAt for any payment that was
    // captured — including ones later refunded (the refund is a separate line).
    if (p.paidAt && ["CAPTURED", "REFUND_PENDING", "REFUNDED"].includes(p.status)) {
      const key = monthKey(p.paidAt);
      (buckets[key] ??= { capturedPaise: 0, refundedPaise: 0, count: 0 });
      buckets[key].capturedPaise += p.amountPaise;
      buckets[key].count += 1;
      totalCapturedPaise += p.amountPaise;
      capturedCount += 1;
    }
    // Refunds are recognised at refundedAt.
    if (p.refundedAt && p.status === "REFUNDED") {
      const key = monthKey(p.refundedAt);
      (buckets[key] ??= { capturedPaise: 0, refundedPaise: 0, count: 0 });
      buckets[key].refundedPaise += p.amountPaise;
      totalRefundedPaise += p.amountPaise;
    }
  }

  const rows = Object.keys(buckets)
    .sort()
    .map((period) => {
      const b = buckets[period];
      return {
        period,
        capturedRevenue: round2(b.capturedPaise / 100),
        refunds: round2(b.refundedPaise / 100),
        netRevenue: round2((b.capturedPaise - b.refundedPaise) / 100),
        payments: b.count,
      };
    });

  return {
    summary: {
      totalRevenue: round2(totalCapturedPaise / 100),
      netRevenue: round2((totalCapturedPaise - totalRefundedPaise) / 100),
      refunds: round2(totalRefundedPaise / 100),
      payments: capturedCount,
      avgOrderValue: capturedCount > 0 ? round2(totalCapturedPaise / 100 / capturedCount) : 0,
    },
    rows,
  };
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
