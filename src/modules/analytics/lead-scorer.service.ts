import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  engagement: number;   // 35% weight
  attributes: number;   // 25% weight
  historical: number;   // 25% weight
  conversation: number; // 15% weight
}

interface LeadWithRelations {
  id: string;
  tenantId: string;
  source: string;
  priority: string;
  travelDate: Date | null;
  numPassengers: number | null;
  departmentId: string;
  stageId: string;
  activities: Array<{
    type: string;
    content: unknown;
    createdAt: Date;
  }>;
  followUps: Array<{
    status: string;
  }>;
  conversations: Array<{
    id: string;
    aiConversations: Array<{
      satisfactionScore: number | null;
    }>;
  }>;
}

// ─── Tier Helper ─────────────────────────────────────────────────────────────

function getTier(score: number): "HOT" | "WARM" | "COOL" | "COLD" {
  if (score >= 76) return "HOT";
  if (score >= 51) return "WARM";
  if (score >= 26) return "COOL";
  return "COLD";
}

// ─── Engagement Score (35%) ───────────────────────────────────────────────────

function computeEngagementScore(lead: LeadWithRelations): number {
  const activities = lead.activities;
  const followUps = lead.followUps;

  // Message count from activities (non-SYSTEM types are direct interactions)
  const messageActivities = activities.filter((a) => a.type !== "SYSTEM");
  const messageScore = Math.min(messageActivities.length * 5, 40); // up to 40 pts

  // Completed follow-ups ratio
  const totalFollowUps = followUps.length;
  const completedFollowUps = followUps.filter((f) => f.status === "COMPLETED").length;
  const followUpRatio = totalFollowUps > 0 ? completedFollowUps / totalFollowUps : 0;
  const followUpScore = Math.round(followUpRatio * 30); // up to 30 pts

  // Total activity count (recency proxy)
  const activityScore = Math.min(activities.length * 2, 30); // up to 30 pts

  return Math.min(messageScore + followUpScore + activityScore, 100);
}

// ─── Attribute Score (25%) ────────────────────────────────────────────────────

function computeAttributeScore(lead: LeadWithRelations): number {
  let score = 0;

  // Source score
  const sourceScores: Record<string, number> = {
    WHATSAPP: 30,
    WEBSITE: 25,
    FB: 20,
    IG: 20,
    MANUAL: 15,
  };
  score += sourceScores[lead.source] ?? 15;

  // Travel date proximity
  if (lead.travelDate) {
    const daysUntilTravel = Math.floor(
      (lead.travelDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysUntilTravel >= 0 && daysUntilTravel < 14) {
      score += 30;
    } else if (daysUntilTravel >= 14 && daysUntilTravel < 30) {
      score += 20;
    } else if (daysUntilTravel >= 30 && daysUntilTravel < 90) {
      score += 10;
    }
  }

  // Passenger count (5 pts per pax, max 20)
  if (lead.numPassengers) {
    score += Math.min(lead.numPassengers * 5, 20);
  }

  // Priority score
  const priorityScores: Record<string, number> = {
    VIP: 20,
    HIGH: 15,
    MEDIUM: 10,
    LOW: 5,
  };
  score += priorityScores[lead.priority] ?? 10;

  return Math.min(score, 100);
}

// ─── Historical Score (25%) ───────────────────────────────────────────────────

async function computeHistoricalScore(
  db: TenantDb,
  tenantId: string,
  lead: LeadWithRelations
): Promise<number> {
  // Fetch department conversion rate from conversion_stats
  const deptStat = await (db.conversionStat as any).findFirst({
    where: {
      tenantId,
      dimension: "DEPARTMENT",
      dimensionValue: lead.departmentId,
    },
    orderBy: { computedAt: "desc" },
    select: { conversionRate: true },
  });

  // Fetch source conversion rate from conversion_stats
  const sourceStat = await (db.conversionStat as any).findFirst({
    where: {
      tenantId,
      dimension: "SOURCE",
      dimensionValue: lead.source,
    },
    orderBy: { computedAt: "desc" },
    select: { conversionRate: true },
  });

  // Default to 50% if no historical data available (neutral)
  const deptRate = deptStat ? deptStat.conversionRate : 50;
  const sourceRate = sourceStat ? sourceStat.conversionRate : 50;

  // Average department and source rates, map from percentage (0-100) to score (0-100)
  const avgRate = (deptRate + sourceRate) / 2;
  return Math.min(Math.round(avgRate), 100);
}

// ─── Conversation Score (15%) ─────────────────────────────────────────────────

function computeConversationScore(lead: LeadWithRelations): number {
  const allAiConversations = lead.conversations.flatMap((c) => c.aiConversations);
  const scoredConversations = allAiConversations.filter(
    (ai) => ai.satisfactionScore !== null
  );

  if (scoredConversations.length === 0) {
    // No AI conversation data — neutral default
    return 50;
  }

  // satisfactionScore is typically 1-5; normalize to 0-100
  const avgSatisfaction =
    scoredConversations.reduce((sum, ai) => sum + (ai.satisfactionScore ?? 0), 0) /
    scoredConversations.length;

  // Assuming scale is 1-5: map to 0-100
  return Math.min(Math.round(((avgSatisfaction - 1) / 4) * 100), 100);
}

// ─── Compute Full Breakdown ────────────────────────────────────────────────────

export async function computeScoreBreakdown(
  db: TenantDb,
  tenantId: string,
  lead: LeadWithRelations
): Promise<ScoreBreakdown> {
  const [engagement, attributes, historical, conversation] = await Promise.all([
    Promise.resolve(computeEngagementScore(lead)),
    Promise.resolve(computeAttributeScore(lead)),
    computeHistoricalScore(db, tenantId, lead),
    Promise.resolve(computeConversationScore(lead)),
  ]);

  return { engagement, attributes, historical, conversation };
}

// ─── Weighted Total Score ─────────────────────────────────────────────────────

function applyWeights(breakdown: ScoreBreakdown): number {
  const total =
    breakdown.engagement * 0.35 +
    breakdown.attributes * 0.25 +
    breakdown.historical * 0.25 +
    breakdown.conversation * 0.15;

  return Math.min(Math.round(total), 100);
}

// ─── Score Lead By ID ─────────────────────────────────────────────────────────

export async function scoreLeadById(
  db: TenantDb,
  tenantId: string,
  leadId: string
): Promise<{
  leadId: string;
  score: number;
  tier: "HOT" | "WARM" | "COOL" | "COLD";
  breakdown: ScoreBreakdown;
  previousScore: number | null;
  previousTier: string | null;
  scoreChange: number | null;
}> {
  // Fetch lead with all scoring-relevant relations
  const lead = await (db.lead as any).findFirst({
    where: { id: leadId, tenantId },
    include: {
      activities: {
        select: { type: true, content: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      followUps: {
        select: { status: true },
      },
      conversations: {
        select: {
          id: true,
          aiConversations: {
            select: { satisfactionScore: true },
          },
        },
      },
    },
  }) as LeadWithRelations | null;

  if (!lead) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  const breakdown = await computeScoreBreakdown(db, tenantId, lead);
  const score = applyWeights(breakdown);
  const tier = getTier(score);

  // Load existing score record to preserve previous values
  const existing = await (db.leadScore as any).findUnique({
    where: { leadId },
    select: { score: true, tier: true },
  });

  const previousScore = existing?.score ?? null;
  const previousTier = existing?.tier ?? null;
  const scoreChange = previousScore !== null ? score - previousScore : null;

  // Upsert into lead_scores — update if exists, preserving previous_score/previous_tier
  await (db.leadScore as any).upsert({
    where: { leadId },
    update: {
      score,
      tier,
      previousScore: previousScore,
      previousTier: previousTier,
      engagementScore: breakdown.engagement,
      attributeScore: breakdown.attributes,
      historicalScore: breakdown.historical,
      conversationScore: breakdown.conversation,
      scoreChange,
      factors: breakdown as unknown as Record<string, unknown>,
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // expires in 24h
    },
    create: {
      tenantId,
      leadId,
      score,
      tier,
      previousScore: null,
      previousTier: null,
      engagementScore: breakdown.engagement,
      attributeScore: breakdown.attributes,
      historicalScore: breakdown.historical,
      conversationScore: breakdown.conversation,
      scoreChange: null,
      factors: breakdown as unknown as Record<string, unknown>,
      computedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return { leadId, score, tier, breakdown, previousScore, previousTier, scoreChange };
}

// ─── Batch Score All Active Leads ─────────────────────────────────────────────

const EXCLUDED_STAGE_SLUGS = ["converted", "won", "closed-won", "lost", "dormant"];

export async function scoreAllActiveLeads(
  db: TenantDb,
  tenantId: string
): Promise<{ scored: number }> {
  // Identify stages to exclude
  const excludedStages = await db.pipelineStage.findMany({
    where: {
      tenantId,
      slug: { in: EXCLUDED_STAGE_SLUGS },
    },
    select: { id: true },
  });

  const excludedStageIds = excludedStages.map((s) => s.id);

  // Fetch all active lead IDs (not in excluded stages)
  const activeLeads = await db.lead.findMany({
    where: {
      tenantId,
      stageId: { notIn: excludedStageIds },
    },
    select: { id: true },
  });

  let scored = 0;
  for (const { id } of activeLeads) {
    try {
      await scoreLeadById(db, tenantId, id);
      scored++;
    } catch {
      // Skip individual failures to avoid stopping the batch
    }
  }

  return { scored };
}
