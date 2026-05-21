import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

// GET /api/widgets/data — fetch widget data by dataSource
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const dataSource = searchParams.get("dataSource");
    const departmentId = searchParams.get("departmentId") || undefined;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!dataSource) {
      return NextResponse.json({ error: "dataSource is required" }, { status: 400 });
    }

    const tenantId = user.tenantId;

    // Date filters
    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // Base where clause
    const baseWhere: Record<string, unknown> = { tenantId };
    if (departmentId) baseWhere.departmentId = departmentId;
    if (hasDateFilter) baseWhere.createdAt = dateFilter;

    // RBAC scoping
    if (user.role === "AGENT") {
      baseWhere.assignedTo = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      baseWhere.departmentId = user.departmentId;
    }
    // COMPANY_ADMIN and SUPER_ADMIN see everything

    const data = await fetchWidgetData(dataSource, tenantId, baseWhere, dateFilter, hasDateFilter, departmentId);

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("Widget data error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchWidgetData(
  dataSource: string,
  tenantId: string,
  baseWhere: Record<string, unknown>,
  dateFilter: Record<string, unknown>,
  hasDateFilter: boolean,
  departmentId?: string
): Promise<unknown> {
  switch (dataSource) {
    case "leads_total": {
      const count = await prisma.lead.count({ where: baseWhere });
      return { value: count, label: "Total Leads" };
    }

    case "leads_by_stage": {
      const stages = await prisma.pipelineStage.findMany({
        where: { tenantId },
        orderBy: { position: "asc" },
      });
      const counts = await prisma.lead.groupBy({
        by: ["stageId"],
        where: baseWhere,
        _count: { id: true },
      });
      const countMap = Object.fromEntries(counts.map((c) => [c.stageId, c._count.id]));
      return stages.map((s) => ({
        name: s.name,
        value: countMap[s.id] || 0,
        color: s.color,
      }));
    }

    case "leads_by_department": {
      const depts = await prisma.department.findMany({
        where: { tenantId, isActive: true },
      });
      const counts = await prisma.lead.groupBy({
        by: ["departmentId"],
        where: { tenantId, ...(hasDateFilter ? { createdAt: dateFilter } : {}) },
        _count: { id: true },
      });
      const countMap = Object.fromEntries(counts.map((c) => [c.departmentId, c._count.id]));
      return depts.map((d) => ({
        name: d.name,
        value: countMap[d.id] || 0,
        color: d.color,
      }));
    }

    case "leads_by_source": {
      const counts = await prisma.lead.groupBy({
        by: ["source"],
        where: baseWhere,
        _count: { id: true },
      });
      return counts.map((c) => ({ name: c.source, value: c._count.id }));
    }

    case "leads_by_date": {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const where: Record<string, unknown> = {
        tenantId,
        createdAt: hasDateFilter ? dateFilter : { gte: thirtyDaysAgo },
      };
      if (departmentId) where.departmentId = departmentId;

      const leads = await prisma.lead.findMany({
        where,
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const byDate: Record<string, number> = {};
      for (const lead of leads) {
        const dateKey = lead.createdAt.toISOString().split("T")[0];
        byDate[dateKey] = (byDate[dateKey] || 0) + 1;
      }

      return Object.entries(byDate).map(([name, value]) => ({ name, value }));
    }

    case "conversion_rate": {
      const total = await prisma.lead.count({ where: baseWhere });

      // Find "converted"/"won" stage
      const convertedStage = await prisma.pipelineStage.findFirst({
        where: {
          tenantId,
          slug: { in: ["converted", "won", "closed-won"] },
        },
      });

      let converted = 0;
      if (convertedStage) {
        const convWhere: Record<string, unknown> = {
          ...baseWhere,
          stageId: convertedStage.id,
        };
        converted = await prisma.lead.count({ where: convWhere });
      }

      const rate = total > 0 ? ((converted / total) * 100) : 0;
      return {
        value: Math.round(rate * 100) / 100,
        label: "Conversion Rate %",
        converted,
        total,
      };
    }

    case "follow_ups_due": {
      const fuDueWhere: Record<string, unknown> = {
        tenantId,
        status: "PENDING",
        scheduledAt: { lte: new Date() },
      };
      if (baseWhere.assignedTo) fuDueWhere.assignedTo = baseWhere.assignedTo;
      if (baseWhere.departmentId) fuDueWhere.departmentId = baseWhere.departmentId;
      const count = await prisma.followUp.count({ where: fuDueWhere });
      return { value: count, label: "Follow-ups Due" };
    }

    case "follow_ups_by_type": {
      const fuTypeWhere: Record<string, unknown> = { tenantId };
      if (baseWhere.assignedTo) fuTypeWhere.assignedTo = baseWhere.assignedTo;
      if (baseWhere.departmentId) fuTypeWhere.departmentId = baseWhere.departmentId;
      const counts = await prisma.followUp.groupBy({
        by: ["type"],
        where: fuTypeWhere,
        _count: { id: true },
      });
      return counts.map((c) => ({ name: c.type, value: c._count.id }));
    }

    case "callbacks_scheduled": {
      const cbWhere: Record<string, unknown> = { tenantId, status: "SCHEDULED" };
      if (baseWhere.assignedTo) cbWhere.assignedTo = baseWhere.assignedTo;
      if (baseWhere.departmentId) cbWhere.departmentId = baseWhere.departmentId;
      const count = await prisma.callback.count({ where: cbWhere });
      return { value: count, label: "Scheduled Callbacks" };
    }

    case "agent_performance": {
      const agents = await prisma.user.findMany({
        where: { tenantId, role: { in: ["AGENT", "DEPT_MANAGER"] }, isActive: true },
        select: { id: true, name: true },
      });

      const leadCounts = await prisma.lead.groupBy({
        by: ["assignedTo"],
        where: { tenantId, assignedTo: { not: null } },
        _count: { id: true },
      });

      const convertedStage = await prisma.pipelineStage.findFirst({
        where: { tenantId, slug: { in: ["converted", "won", "closed-won"] } },
      });

      let convertedCounts: { assignedTo: string | null; _count: { id: number } }[] = [];
      if (convertedStage) {
        convertedCounts = await (prisma.lead.groupBy as any)({
          by: ["assignedTo"],
          where: { tenantId, assignedTo: { not: null }, stageId: convertedStage.id },
          _count: { id: true },
        });
      }

      const leadMap = Object.fromEntries(leadCounts.map((c) => [c.assignedTo, c._count.id]));
      const convMap = Object.fromEntries(convertedCounts.map((c) => [c.assignedTo, c._count.id]));

      return agents.map((a) => ({
        name: a.name,
        leads: leadMap[a.id] || 0,
        converted: convMap[a.id] || 0,
        rate: leadMap[a.id] ? Math.round(((convMap[a.id] || 0) / leadMap[a.id]) * 100) : 0,
      }));
    }

    case "department_performance": {
      const depts = await prisma.department.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
      });

      const leadCounts = await prisma.lead.groupBy({
        by: ["departmentId"],
        where: { tenantId },
        _count: { id: true },
      });

      const convertedStage = await prisma.pipelineStage.findFirst({
        where: { tenantId, slug: { in: ["converted", "won", "closed-won"] } },
      });

      let convertedCounts: { departmentId: string; _count: { id: number } }[] = [];
      if (convertedStage) {
        convertedCounts = await (prisma.lead.groupBy as any)({
          by: ["departmentId"],
          where: { tenantId, stageId: convertedStage.id },
          _count: { id: true },
        });
      }

      const leadMap = Object.fromEntries(leadCounts.map((c) => [c.departmentId, c._count.id]));
      const convMap = Object.fromEntries(convertedCounts.map((c) => [c.departmentId, c._count.id]));

      return depts.map((d) => ({
        name: d.name,
        leads: leadMap[d.id] || 0,
        converted: convMap[d.id] || 0,
        rate: leadMap[d.id] ? Math.round(((convMap[d.id] || 0) / leadMap[d.id]) * 100) : 0,
      }));
    }

    case "recent_leads": {
      const leads = await prisma.lead.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          customer: { select: { name: true, mobile: true } },
          stage: { select: { name: true, color: true } },
          department: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      });
      return leads.map((l) => ({
        id: l.id,
        customer: l.customer.name,
        mobile: l.customer.mobile,
        stage: l.stage.name,
        stageColor: l.stage.color,
        department: l.department.name,
        assignee: l.assignee?.name || "Unassigned",
        destination: l.destination,
        createdAt: l.createdAt,
      }));
    }

    case "recent_activities": {
      const activities = await prisma.leadActivity.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          user: { select: { name: true } },
          lead: {
            select: {
              customer: { select: { name: true } },
            },
          },
        },
      });
      return activities.map((a) => ({
        id: a.id,
        type: a.type,
        content: a.content,
        user: a.user?.name || "System",
        customer: a.lead.customer.name,
        createdAt: a.createdAt,
      }));
    }

    case "response_time_avg": {
      // Average time from lead creation to first activity
      const leads = await prisma.lead.findMany({
        where: { ...baseWhere },
        select: { id: true, createdAt: true },
        take: 200,
        orderBy: { createdAt: "desc" },
      });

      if (leads.length === 0) {
        return { value: 0, label: "Avg Response Time (hours)" };
      }

      const leadIds = leads.map((l) => l.id);
      const firstActivities = await prisma.leadActivity.findMany({
        where: {
          tenantId,
          leadId: { in: leadIds },
          type: { not: "SYSTEM" },
        },
        orderBy: { createdAt: "asc" },
        distinct: ["leadId"],
        select: { leadId: true, createdAt: true },
      });

      const leadCreateMap = Object.fromEntries(leads.map((l) => [l.id, l.createdAt]));
      let totalHours = 0;
      let count = 0;

      for (const activity of firstActivities) {
        const leadCreated = leadCreateMap[activity.leadId];
        if (leadCreated) {
          const diffMs = activity.createdAt.getTime() - leadCreated.getTime();
          totalHours += diffMs / (1000 * 60 * 60);
          count++;
        }
      }

      const avg = count > 0 ? Math.round((totalHours / count) * 10) / 10 : 0;
      return { value: avg, label: "Avg Response Time (hours)" };
    }

    default:
      return { error: "Unknown dataSource" };
  }
}
