/**
 * Global search utility using PostgreSQL ILIKE (case-insensitive).
 * Phase 1 — no full-text tsvector, just simple ILIKE for each entity.
 */

type PrismaClient = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export interface SearchResults {
  customers: Array<{
    id: string;
    name: string;
    mobile: string;
    email: string | null;
  }>;
  leads: Array<{
    id: string;
    customer: { name: string };
    department: { name: string };
    stage: { name: string };
  }>;
  conversations: Array<{
    id: string;
    status: string;
    lead: { customer: { name: string } };
  }>;
}

const MAX_RESULTS_PER_CATEGORY = 5;

/**
 * Search across customers, leads, and conversations.
 * Returns max 5 results per category.
 */
export async function globalSearch(
  db: PrismaClient,
  query: string
): Promise<SearchResults> {
  const q = query.trim();
  if (!q) {
    return { customers: [], leads: [], conversations: [] };
  }

  const [customers, leads, conversations] = await Promise.all([
    // Search customers by name, email, mobile
    db.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { mobile: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        mobile: true,
        email: true,
      },
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { updatedAt: "desc" },
    }),

    // Search leads by customer name, destination
    db.lead.findMany({
      where: {
        OR: [
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { destination: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        customer: { select: { name: true } },
        department: { select: { name: true } },
        stage: { select: { name: true } },
      },
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { updatedAt: "desc" },
    }),

    // Search conversations by customer name
    db.conversation.findMany({
      where: {
        lead: {
          customer: { name: { contains: q, mode: "insensitive" } },
        },
      },
      select: {
        id: true,
        status: true,
        lead: {
          select: {
            customer: { select: { name: true } },
          },
        },
      },
      take: MAX_RESULTS_PER_CATEGORY,
      orderBy: { startedAt: "desc" },
    }),
  ]);

  return { customers, leads, conversations };
}
