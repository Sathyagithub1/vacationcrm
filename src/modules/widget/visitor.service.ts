import { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

interface VisitorMetadata {
  pageUrl?: string;
  referrer?: string;
  userAgent?: string;
}

type VisitorRecord = {
  id: string;
  visitorId: string;
  customerId: string | null;
  firstPageUrl: string | null;
  referrerUrl: string | null;
  userAgent: string | null;
  totalVisits: number;
  totalMessages: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/**
 * Find a visitor by their client-generated visitorId or create a new record.
 * On every call the record's lastSeenAt is refreshed and totalVisits is incremented
 * when the visitor is returning (i.e. an existing record was found).
 */
export async function getOrCreateVisitor(
  db: TenantDb,
  visitorId: string,
  metadata: VisitorMetadata
): Promise<VisitorRecord> {
  const existing = await (db as any).widgetVisitor.findFirst({ where: { visitorId } }) as VisitorRecord | null;

  if (existing) {
    // Returning visitor — bump stats, preserve first page/referrer
    return (db as any).widgetVisitor.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        totalVisits: { increment: 1 },
        ...(metadata.pageUrl && !existing.firstPageUrl ? { firstPageUrl: metadata.pageUrl } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        ...(metadata.referrer && !existing.referrerUrl ? { referrerUrl: metadata.referrer } : {}),
      },
    }) as Promise<VisitorRecord>;
  }

  // New visitor — race-safe against concurrent session requests for the same visitorId.
  // (tenantId, visitorId) is uniquely indexed, so we catch P2002 and fall through to update.
  try {
    return await (db as any).widgetVisitor.create({
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
    }) as VisitorRecord;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "P2002") throw err;

    const concurrent = await (db as any).widgetVisitor.findFirst({ where: { visitorId } }) as VisitorRecord | null;
    if (!concurrent) throw err;

    return (db as any).widgetVisitor.update({
      where: { id: concurrent.id },
      data: {
        lastSeenAt: new Date(),
        totalVisits: { increment: 1 },
        ...(metadata.pageUrl && !concurrent.firstPageUrl ? { firstPageUrl: metadata.pageUrl } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        ...(metadata.referrer && !concurrent.referrerUrl ? { referrerUrl: metadata.referrer } : {}),
      },
    }) as VisitorRecord;
  }
}

/**
 * Link an anonymous visitor to an identified Customer record.
 * Idempotent — if already linked to the same customer this is a no-op.
 */
export async function linkVisitorToCustomer(
  db: TenantDb,
  visitorId: string,
  customerId: string
): Promise<VisitorRecord> {
  const visitor = await (db as any).widgetVisitor.findFirst({ where: { visitorId } }) as VisitorRecord | null;
  if (!visitor) throw new Error("Visitor not found");

  // Already linked to this customer — nothing to do
  if (visitor.customerId === customerId) return visitor;

  return (db as any).widgetVisitor.update({
    where: { id: visitor.id },
    data: { customerId },
  }) as Promise<VisitorRecord>;
}

/**
 * Increment the totalMessages counter for a visitor.
 */
export async function incrementVisitorMessages(db: TenantDb, visitorId: string): Promise<void> {
  const visitor = await (db as any).widgetVisitor.findFirst({ where: { visitorId } }) as VisitorRecord | null;
  if (!visitor) return;

  await (db as any).widgetVisitor.update({
    where: { id: visitor.id },
    data: { totalMessages: { increment: 1 } },
  });
}
