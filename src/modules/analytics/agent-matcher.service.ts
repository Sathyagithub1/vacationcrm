import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadAttributes {
  source?: string;
  priority?: string;
  destination?: string;
  departmentId: string;
}

export interface RankedAgent {
  agentId: string;
  agentName: string;
  totalScore: number;
  breakdown: {
    conversionRate: number;      // 0-100 raw rate
    specialtyMatch: number;      // 0-100 specialty score
    loadInverse: number;         // 0-100 (lower load = higher score)
    satisfaction: number;        // 0-100 avg AI satisfaction
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a conversion rate (0-100%) to a 0-100 score component.
 * The rate is already expressed as a percentage in conversion_stats.
 */
function rateToScore(rate: number): number {
  return Math.min(Math.round(rate), 100);
}

/**
 * Compute specialty match score for an agent given lead attributes.
 * Uses department alignment as the primary signal.
 */
function computeSpecialtyMatch(
  agentDepartmentId: string | null,
  leadAttributes: LeadAttributes
): number {
  if (!agentDepartmentId) return 0;

  // Department match is the primary specialty signal (full score)
  if (agentDepartmentId === leadAttributes.departmentId) return 100;

  return 0;
}

/**
 * Compute load inverse score. Fewer active leads = higher score.
 * active_leads >= 20 → score 0; active_leads = 0 → score 100.
 */
function computeLoadInverse(activeLeadCount: number): number {
  const maxLoad = 20;
  return Math.max(0, Math.round(((maxLoad - activeLeadCount) / maxLoad) * 100));
}

/**
 * Compute average AI satisfaction score for an agent across all their
 * assigned leads' conversations. Returns 0-100.
 */
async function computeAgentSatisfaction(
  db: TenantDb,
  tenantId: string,
  agentId: string
): Promise<number> {
  // Get all leads assigned to the agent
  const assignedLeadIds = (
    await db.lead.findMany({
      where: { tenantId, assignedTo: agentId },
      select: { id: true },
    })
  ).map((l) => l.id);

  if (assignedLeadIds.length === 0) return 50; // neutral default

  // Get conversations for those leads
  const conversations = await db.conversation.findMany({
    where: {
      tenantId,
      leadId: { in: assignedLeadIds },
    },
    select: { id: true },
  });

  if (conversations.length === 0) return 50;

  const conversationIds = conversations.map((c) => c.id);

  const aiConversations = await (db.aIConversation as any).findMany({
    where: {
      tenantId,
      conversationId: { in: conversationIds },
      satisfactionScore: { not: null },
    },
    select: { satisfactionScore: true },
  });

  if (aiConversations.length === 0) return 50;

  const avg =
    aiConversations.reduce(
      (sum: number, ai: { satisfactionScore: number }) => sum + ai.satisfactionScore,
      0
    ) / aiConversations.length;

  // satisfactionScore scale is 1-5; normalize to 0-100
  return Math.min(Math.round(((avg - 1) / 4) * 100), 100);
}

// ─── Find Best Agent ──────────────────────────────────────────────────────────

/**
 * Scores all active agents in the given department and returns a ranked list.
 *
 * Scoring formula:
 *   total = (conversion_rate × 0.4) + (specialty_match × 0.3) + (load_inverse × 0.2) + (satisfaction × 0.1)
 */
export async function findBestAgent(
  db: TenantDb,
  tenantId: string,
  departmentId: string,
  leadAttributes: LeadAttributes
): Promise<RankedAgent[]> {
  // Fetch active agents in this department (also include dept managers)
  const agents = await db.user.findMany({
    where: {
      tenantId,
      departmentId,
      role: { in: ["AGENT", "DEPT_MANAGER"] },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      departmentId: true,
    },
  });

  if (agents.length === 0) return [];

  // Fetch conversion rates for each agent from conversion_stats
  const agentStats = await (db.conversionStat as any).findMany({
    where: {
      tenantId,
      dimension: "AGENT",
      dimensionValue: { in: agents.map((a) => a.id) },
    },
    select: { dimensionValue: true, conversionRate: true },
  });

  const conversionRateMap = Object.fromEntries(
    agentStats.map((s: { dimensionValue: string; conversionRate: number }) => [
      s.dimensionValue,
      s.conversionRate,
    ])
  );

  // Fetch current active lead counts per agent (load)
  const activeLeadCounts = await db.lead.groupBy({
    by: ["assignedTo"],
    where: {
      tenantId,
      assignedTo: { in: agents.map((a) => a.id) },
    },
    _count: { id: true },
  });

  const loadMap = Object.fromEntries(
    activeLeadCounts.map((c) => [c.assignedTo as string, c._count.id])
  );

  // Compute scores for each agent in parallel
  const scored = await Promise.all(
    agents.map(async (agent) => {
      const conversionRatePct = conversionRateMap[agent.id] ?? 0;
      const specialtyMatch = computeSpecialtyMatch(agent.departmentId, leadAttributes);
      const loadInverse = computeLoadInverse(loadMap[agent.id] ?? 0);
      const satisfaction = await computeAgentSatisfaction(db, tenantId, agent.id);

      const totalScore =
        rateToScore(conversionRatePct) * 0.4 +
        specialtyMatch * 0.3 +
        loadInverse * 0.2 +
        satisfaction * 0.1;

      return {
        agentId: agent.id,
        agentName: agent.name,
        totalScore: Math.round(totalScore * 10) / 10,
        breakdown: {
          conversionRate: conversionRatePct,
          specialtyMatch,
          loadInverse,
          satisfaction,
        },
      } satisfies RankedAgent;
    })
  );

  // Return ranked descending by totalScore
  return scored.sort((a, b) => b.totalScore - a.totalScore);
}
