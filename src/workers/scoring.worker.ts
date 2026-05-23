/**
 * Scoring Worker
 *
 * Recomputes lead scores on events (lead created, stage changed, message received)
 * and runs nightly batch scoring for all active leads.
 */
import { Worker, Job } from "bullmq";
import { prisma, tenantPrisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const QUEUE_NAME = "scoring";

interface ScoringJob {
  tenantId: string;
  leadId?: string;
  trigger: "lead_created" | "stage_changed" | "message_received" | "followup_completed" | "batch";
}

async function processScoring(jobData: ScoringJob) {
  const { tenantId, leadId, trigger } = jobData;
  const db = tenantPrisma(tenantId);

  if (trigger === "batch" || !leadId) {
    // Batch score all active leads
    const leads = await db.lead.findMany({
      where: {
        stage: { slug: { notIn: ["converted", "lost", "dormant"] } },
      },
      select: { id: true },
    });

    let scored = 0;
    for (const lead of leads) {
      try {
        await scoreOneLead(db, tenantId, lead.id);
        scored++;
      } catch (err) {
        console.error(`[Scoring Worker] Failed to score lead ${lead.id}:`, err);
      }
    }
    console.log(`[Scoring Worker] Batch scored ${scored}/${leads.length} leads for tenant ${tenantId}`);
    return;
  }

  // Single lead scoring
  try {
    await scoreOneLead(db, tenantId, leadId);
    console.log(`[Scoring Worker] Scored lead ${leadId} (trigger: ${trigger})`);
  } catch (err) {
    console.error(`[Scoring Worker] Failed to score lead ${leadId}:`, err);
    throw err;
  }
}

async function scoreOneLead(
  db: ReturnType<typeof tenantPrisma>,
  tenantId: string,
  leadId: string
) {
  const lead = await (db.lead.findUnique as Function)({
    where: { id: leadId },
    include: {
      customer: true,
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      followUps: true,
      department: true,
      stage: true,
    },
  });

  if (!lead) return;

  // Compute engagement score (0-100)
  const activities = (lead.activities as Array<Record<string, unknown>>) || [];
  const followUps = (lead.followUps as Array<Record<string, unknown>>) || [];
  const msgCount = activities.filter((a) =>
    ["NOTE", "CALL", "EMAIL"].includes(a.type as string)
  ).length;
  const completedFollowUps = followUps.filter((f) => f.status === "COMPLETED").length;
  const totalFollowUps = followUps.length;
  const engagement = Math.min(
    100,
    msgCount * 10 +
      (totalFollowUps > 0 ? (completedFollowUps / totalFollowUps) * 40 : 0) +
      Math.min(20, activities.length * 4)
  );

  // Compute attributes score (0-100)
  const sourceScores: Record<string, number> = {
    WHATSAPP: 30, WEBSITE: 25, FB: 20, IG: 20, MANUAL: 15,
  };
  const travelDate = lead.travelDate ? new Date(lead.travelDate as string) : null;
  const daysUntilTravel = travelDate
    ? Math.max(0, (travelDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 999;
  const travelProximity = daysUntilTravel < 14 ? 30 : daysUntilTravel < 30 ? 20 : daysUntilTravel < 90 ? 10 : 0;
  const paxScore = Math.min(20, ((lead.numPassengers as number) || 1) * 5);
  const priorityScores: Record<string, number> = {
    VIP: 20, HIGH: 15, MEDIUM: 10, LOW: 5,
  };
  const attributes = Math.min(
    100,
    (sourceScores[lead.source as string] || 15) +
      travelProximity +
      paxScore +
      (priorityScores[lead.priority as string] || 10)
  );

  // Compute historical score (0-100) — from conversion_stats
  let historical = 50; // Default when no stats available
  try {
    const convStats = await db.conversionStat.findMany({
      where: {
        dimension: { in: ["DEPARTMENT", "SOURCE"] },
        dimensionValue: { in: [lead.departmentId, lead.source] },
      },
    });
    if (convStats.length > 0) {
      const deptRate =
        (convStats as Array<Record<string, unknown>>).find(
          (s) => s.dimension === "DEPARTMENT"
        )?.conversionRate || 0;
      const sourceRate =
        (convStats as Array<Record<string, unknown>>).find(
          (s) => s.dimension === "SOURCE"
        )?.conversionRate || 0;
      historical = Math.min(100, ((deptRate as number) * 50 + (sourceRate as number) * 50));
    }
  } catch {
    // Table might not have data yet
  }

  // Compute conversation score (0-100) — from AI satisfaction
  let conversation = 50; // Default
  try {
    const aiConvs = await db.aIConversation.findMany({
      where: {
        conversation: { leadId },
      },
      select: { satisfactionScore: true },
    });
    if (aiConvs.length > 0) {
      const scores = (aiConvs as Array<Record<string, unknown>>)
        .map((c) => (c.satisfactionScore as number) || 50);
      conversation = Math.min(100, scores.reduce((a, b) => a + b, 0) / scores.length);
    }
  } catch {
    // AI conversations might not exist yet
  }

  // Compute total score (weighted)
  const totalScore = Math.round(
    engagement * 0.35 +
      attributes * 0.25 +
      historical * 0.25 +
      conversation * 0.15
  );
  const clampedScore = Math.max(0, Math.min(100, totalScore));
  const tier = clampedScore >= 76 ? "HOT" : clampedScore >= 51 ? "WARM" : clampedScore >= 26 ? "COOL" : "COLD";

  // Upsert lead score
  const existing = await (db.leadScore.findUnique as Function)({
    where: { leadId },
  });

  const scoreData = {
    tenantId,
    leadId,
    score: clampedScore,
    tier,
    previousScore: existing?.score ?? null,
    previousTier: existing?.tier ?? null,
    engagementScore: engagement,
    attributeScore: attributes,
    historicalScore: historical,
    conversationScore: conversation,
    factors: { engagement, attributes, historical, conversation },
    scoreChange: existing ? clampedScore - (existing.score as number) : null,
    computedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  if (existing) {
    await (db.leadScore.update as Function)({
      where: { leadId },
      data: scoreData,
    });
  } else {
    await (db.leadScore.create as Function)({
      data: scoreData,
    });
  }
}

export function createScoringWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[Scoring Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<ScoringJob>) => {
      await processScoring(job.data);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Scoring Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Scoring Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Scoring Worker] Started");
  return worker;
}
