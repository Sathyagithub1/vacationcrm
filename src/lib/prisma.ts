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
    // Expose the scope so callers can pass `tenantId: db.$tenantId` in create
    // data and satisfy Prisma's input types honestly. $allOperations below
    // still forces the same tenantId onto every create, so this cannot widen
    // scope. Also available on interactive-transaction clients.
    client: { $tenantId: tenantId },
    query: {
      async $allOperations({ model, operation, args, query }) {
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
          // Phase 6d: voice + IVR
          "VoiceCall",
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

        // Phase 6i — `findUnique` accepts only the unique-key shape (e.g.
        // `{ id }`); Prisma rejects/strips arbitrary extra fields in `where`,
        // so injecting `tenantId` into it does NOT enforce tenant scoping —
        // the guarantee silently went missing. Run the query unmodified and
        // verify ownership on the way out: if the row belongs to a different
        // tenant, return null exactly as if the row did not exist.
        if (operation === "findUnique" || operation === "findUniqueOrThrow") {
          const result = await query(args);
          if (result && typeof result === "object" && "tenantId" in result) {
            if ((result as { tenantId?: string }).tenantId !== tenantId) {
              if (operation === "findUniqueOrThrow") {
                throw new Error(`No ${model} found`);
              }
              return null;
            }
          }
          return result;
        }

        if (["findMany", "findFirst", "count", "aggregate", "groupBy",
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

/** A tenant-scoped client, as returned by tenantPrisma(). */
export type TenantDb = ReturnType<typeof tenantPrisma>;

/** The client handed to a TenantDb interactive-transaction callback. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
