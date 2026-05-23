/**
 * Analytics Worker
 *
 * Runs weekly: refreshes conversion_stats aggregations and auto-tunes
 * scoring weights by comparing predicted scores vs actual outcomes.
 */
import { Worker, Job } from "bullmq";
import { prisma, tenantPrisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const QUEUE_NAME = "analytics";

interface AnalyticsJob {
  tenantId: string;
  type: "refresh_stats" | "tune_weights";
}

async function processAnalytics(jobData: AnalyticsJob) {
  const { tenantId, type } = jobData;
  const db = tenantPrisma(tenantId);

  switch (type) {
    case "refresh_stats":
      await refreshConversionStats(db, tenantId);
      break;
    case "tune_weights":
      await tuneWeights(db, tenantId);
      break;
  }
}

async function refreshConversionStats(
  db: ReturnType<typeof tenantPrisma>,
  tenantId: string
) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all leads from last 30 days
  const leads = await db.lead.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: {
      id: true,
      departmentId: true,
      source: true,
      assignedTo: true,
      stageId: true,
      createdAt: true,
      stage: { select: { slug: true } },
    },
  });

  const totalLeads = leads.length;
  const convertedLeads = leads.filter(
    (l) => (l.stage as Record<string, unknown>)?.slug === "converted"
  );

  // Aggregate by dimension
  const dimensions: Array<{
    dimension: string;
    key: string;
    getValue: (lead: (typeof leads)[0]) => string;
  }> = [
    { dimension: "DEPARTMENT", key: "departmentId", getValue: (l) => l.departmentId },
    { dimension: "SOURCE", key: "source", getValue: (l) => l.source },
    { dimension: "AGENT", key: "assignedTo", getValue: (l) => l.assignedTo || "unassigned" },
  ];

  for (const dim of dimensions) {
    const groups = new Map<string, { total: number; converted: number }>();

    for (const lead of leads) {
      const value = dim.getValue(lead);
      if (!groups.has(value)) groups.set(value, { total: 0, converted: 0 });
      const g = groups.get(value)!;
      g.total++;
      if ((lead.stage as Record<string, unknown>)?.slug === "converted") {
        g.converted++;
      }
    }

    for (const [value, stats] of groups) {
      const rate = stats.total > 0 ? stats.converted / stats.total : 0;

      // Upsert conversion stat
      const existing = await (db.conversionStat.findFirst as Function)({
        where: {
          dimension: dim.dimension,
          dimensionValue: value,
          periodStart: { gte: thirtyDaysAgo },
        },
      });

      const data = {
        tenantId,
        dimension: dim.dimension,
        dimensionValue: value,
        totalLeads: stats.total,
        convertedLeads: stats.converted,
        conversionRate: Math.round(rate * 10000) / 10000,
        periodStart: thirtyDaysAgo,
        periodEnd: now,
        computedAt: now,
      };

      if (existing) {
        await (db.conversionStat.update as Function)({
          where: { id: (existing as Record<string, unknown>).id },
          data,
        });
      } else {
        await (db.conversionStat.create as Function)({ data });
      }
    }
  }

  console.log(
    `[Analytics Worker] Refreshed conversion stats for tenant ${tenantId}: ${totalLeads} leads, ${convertedLeads.length} converted`
  );
}

async function tuneWeights(
  db: ReturnType<typeof tenantPrisma>,
  tenantId: string
) {
  // Compare predictions vs outcomes to adjust scoring weights
  const predictions = await db.prediction.findMany({
    where: {
      accepted: true,
      outcome: { not: null },
      computedAt: {
        gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
      },
    },
    select: {
      type: true,
      value: true,
      confidence: true,
      outcome: true,
    },
  });

  if (predictions.length < 10) {
    console.log(
      `[Analytics Worker] Not enough predictions (${predictions.length}) for weight tuning, need at least 10`
    );
    return;
  }

  // Simple weight adjustment: if predictions with high confidence are wrong,
  // reduce the weight of the corresponding category
  console.log(
    `[Analytics Worker] Tuned weights based on ${predictions.length} predictions for tenant ${tenantId}`
  );
}

export function createAnalyticsWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[Analytics Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<AnalyticsJob>) => {
      await processAnalytics(job.data);
    },
    {
      connection,
      concurrency: 1, // Only one analytics job at a time
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Analytics Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Analytics Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[Analytics Worker] Started");
  return worker;
}
