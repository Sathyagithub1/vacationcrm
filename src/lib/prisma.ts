import { PrismaClient } from "@prisma/client";
import { attachTourSoldMiddleware } from "./prisma-middleware-tour-sold";

// We keep the raw PrismaClient in the global for dev hot-reload caching.
// The extended client (with tour-sold hooks) is what consumers use.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaExtended: ReturnType<typeof attachTourSoldMiddleware>;
};

function createExtendedClient() {
  const base = new PrismaClient();
  return attachTourSoldMiddleware(base);
}

export const prisma: ReturnType<typeof attachTourSoldMiddleware> =
  globalForPrisma.prismaExtended || createExtendedClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaExtended = prisma;
}

// Tenant-scoped Prisma client
export function tenantPrisma(tenantId: string) {
  return prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        if (model === "Tenant") return query(args);

        const modelsWithTenant = [
          "User", "Invitation", "Department", "PipelineStage", "Customer",
          "Lead", "LeadActivity", "FollowUp", "FollowUpRule", "Callback",
          "Conversation", "Message", "Notification", "Escalation",
          "Broadcast", "CannedResponse", "AuditLog", "FileUpload", "DashboardWidget",
          "AIProvider", "KnowledgeBase", "AIConversation", "AIToolCall",
          "ChannelConfig", "CustomerChannel", "MessageDelivery", "WebhookLog",
          "WidgetConfig", "WidgetVisitor",
          "LeadScore", "Prediction", "ScoringWeight", "ConversionStat",
          "Tour",
          // Phase 6a additions (intake, assignment, spam, tags)
          "IntakeForm", "AssignmentStrategy", "AssignmentPool",
          "Tag", "SpamRule", "SpamLog",
          // Phase 6c: payments
          "Payment",
          // TourBooking is intentionally excluded — it has no `tenantId` column;
          // scope is inherited via the Tour relation. Callers must filter via tourId.
        ];

        if (!model || !modelsWithTenant.includes(model)) return query(args);

        if (["create", "createMany"].includes(operation)) {
          if ("data" in args) {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d: any) => ({ ...d, tenantId }));
            } else {
              (args.data as any).tenantId = tenantId;
            }
          }
        }

        if (["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy",
             "update", "updateMany", "delete", "deleteMany", "upsert"].includes(operation)) {
          if ("where" in args) {
            (args.where as any).tenantId = tenantId;
          } else {
            (args as any).where = { tenantId };
          }
        }

        return query(args);
      },
    },
  });
}
