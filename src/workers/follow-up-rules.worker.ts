/**
 * Follow-up Rules Worker
 *
 * Processes stage-change events, finds matching FollowUpRules,
 * and creates FollowUp records scheduled at the appropriate time.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const QUEUE_NAME = "follow-up-rules";

interface StageChangeJob {
  tenantId: string;
  leadId: string;
  stageSlug: string;
  assignedTo: string;
}

async function processStageChange(data: StageChangeJob) {
  const { tenantId, leadId, stageSlug, assignedTo } = data;

  // Find matching rules for this tenant and stage
  const rules = await prisma.followUpRule.findMany({
    where: {
      tenantId,
      isActive: true,
      triggerType: "STAGE_CHANGE",
      triggerValue: stageSlug,
    },
  });

  if (rules.length === 0) {
    console.log(`[FollowUpRules Worker] No matching rules for stage "${stageSlug}" in tenant ${tenantId}`);
    return 0;
  }

  // Check if lead exists and get department
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { departmentId: true },
  });

  if (!lead) {
    console.warn(`[FollowUpRules Worker] Lead ${leadId} not found, skipping`);
    return 0;
  }

  let created = 0;

  for (const rule of rules) {
    try {
      // If rule is department-scoped, check department match
      if (rule.departmentId && rule.departmentId !== lead.departmentId) {
        continue;
      }

      const scheduledAt = new Date();
      scheduledAt.setHours(scheduledAt.getHours() + rule.delayHours);

      await prisma.followUp.create({
        data: {
          tenantId,
          leadId,
          assignedTo,
          type: rule.followUpType,
          scheduledAt,
          messageTemplate: rule.messageTemplate,
          status: "PENDING",
        },
      });

      created++;
      console.log(`[FollowUpRules Worker] Created follow-up for rule ${rule.id}, scheduled at ${scheduledAt.toISOString()}`);
    } catch (err) {
      console.error(`[FollowUpRules Worker] Error creating follow-up for rule ${rule.id}:`, err);
      // Continue with next rule
    }
  }

  return created;
}

export function createFollowUpRulesWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[FollowUpRules Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<StageChangeJob>) => {
      return processStageChange(job.data);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[FollowUpRules Worker] Job ${job.id} completed, created ${result} follow-ups`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[FollowUpRules Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[FollowUpRules Worker] Started");
  return worker;
}

export { processStageChange };
