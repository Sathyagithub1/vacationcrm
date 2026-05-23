import { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

interface VisitorMetadata {
  pageUrl?: string;
  referrer?: string;
  userAgent?: string;
}

/**
 * Find a visitor by their client-generated visitorId or create a new record.
 * On every call the record's lastSeenAt is refreshed and totalVisits is incremented
 * when the visitor is returning (i.e. an existing record was found).
 */
export async function getOrCreateVisitor(
  db: TenantDb,
  visitorId: string,
  metadata: VisitorMetadata
) {
  const existing = await db.widgetVisitor.findFirst({ where: { visitorId } });

  if (existing) {
    // Returning visitor — bump stats
    return (db.widgetVisitor.update as Function)({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        totalVisits: { increment: 1 },
        // Update metadata if provided
        ...(metadata.pageUrl ? { firstPageUrl: existing.firstPageUrl ?? metadata.pageUrl } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        ...(metadata.referrer ? { referrerUrl: existing.referrerUrl ?? metadata.referrer } : {}),
      },
    });
  }

  // New visitor
  return (db.widgetVisitor.create as Function)({
    data: {
      visitorId,
      firstPageUrl: metadata.pageUrl ?? null,
      referrerUrl: metadata.referrer ?? null,
      userAgent: metadata.userAgent ?? null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      totalVisits: 1,
      totalMessages: 0,
    },
  });
}

/**
 * Link an anonymous visitor to an identified Customer record.
 * Idempotent — if already linked to the same customer this is a no-op.
 */
export async function linkVisitorToCustomer(
  db: TenantDb,
  visitorId: string,
  customerId: string
) {
  const visitor = await db.widgetVisitor.findFirst({ where: { visitorId } });
  if (!visitor) throw new Error("Visitor not found");

  // Already linked to this customer — nothing to do
  if (visitor.customerId === customerId) return visitor;

  return (db.widgetVisitor.update as Function)({
    where: { id: visitor.id },
    data: { customerId },
  });
}

/**
 * Increment the totalMessages counter for a visitor.
 */
export async function incrementVisitorMessages(db: TenantDb, visitorId: string) {
  const visitor = await db.widgetVisitor.findFirst({ where: { visitorId } });
  if (!visitor) return;

  await (db.widgetVisitor.update as Function)({
    where: { id: visitor.id },
    data: { totalMessages: { increment: 1 } },
  });
}
