import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
