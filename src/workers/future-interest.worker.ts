/**
 * Future Interest Worker (Stub)
 *
 * When a service/destination flagged as "future interest" launches or becomes available,
 * this worker notifies customers who expressed interest via their leads.
 *
 * Currently a stub -- will be fully implemented when service launch tracking is added.
 */
import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createNotification } from "@/modules/notifications/notification.service";

const QUEUE_NAME = "future-interest";

interface FutureInterestJob {
  tenantId: string;
  destination?: string;
  departmentId?: string;
  serviceName?: string;
}

async function processFutureInterest(data: FutureInterestJob) {
  const { tenantId, destination, departmentId } = data;

  // Find leads marked as future interest matching the criteria
  const where: Record<string, unknown> = {
    tenantId,
    isFutureInterest: true,
  };

  if (destination) where.destination = destination;
  if (departmentId) where.departmentId = departmentId;

  const leads = await prisma.lead.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      assignee: { select: { id: true } },
    },
    take: 100,
  });

  if (leads.length === 0) {
    console.log("[FutureInterest Worker] No matching future-interest leads found");
    return 0;
  }

  let notified = 0;

  for (const lead of leads) {
    try {
      if (!lead.assignedTo) continue;

      await createNotification({
        tenantId: lead.tenantId,
        userId: lead.assignedTo,
        type: "LEAD_ASSIGNED",
        title: "Future Interest: Service Now Available",
        body: `${lead.customer.name} expressed interest in ${lead.destination || "a service"} which is now available. Follow up to convert.`,
        data: {
          leadId: lead.id,
          destination: lead.destination,
          isFutureInterest: true,
        },
      });

      notified++;
    } catch (err) {
      console.error(`[FutureInterest Worker] Error notifying for lead ${lead.id}:`, err);
    }
  }

  console.log(`[FutureInterest Worker] Notified ${notified} agents about future-interest leads`);
  return notified;
}

export function createFutureInterestWorker() {
  const connection = getRedis();
  if (!connection) {
    console.warn("[FutureInterest Worker] Redis not available, worker not started");
    return null;
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<FutureInterestJob>) => {
      return processFutureInterest(job.data);
    },
    {
      connection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[FutureInterest Worker] Job ${job.id} completed, notified ${result} agents`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[FutureInterest Worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[FutureInterest Worker] Started");
  return worker;
}

export { processFutureInterest };
