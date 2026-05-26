/**
 * Global search utility using PostgreSQL ILIKE (case-insensitive).
 * Phase 1 — no full-text tsvector, just simple ILIKE for each entity.
 */

import type { Role } from "@prisma/client";

type PrismaClient = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface SearchUserContext {
  role: Role;
  userId: string;
  departmentId: string | null;
}

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
    department: { name: string } | null;
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
  query: string,
  userCtx?: SearchUserContext
): Promise<SearchResults> {
  const q = query.trim();
  if (!q) {
    return { customers: [], leads: [], conversations: [] };
  }

  // Build RBAC filter for leads
  const leadRbacFilter: Record<string, unknown> = {};
  if (userCtx) {
    if (userCtx.role === "AGENT") {
      leadRbacFilter.assignedTo = userCtx.userId;
    } else if (userCtx.role === "DEPT_MANAGER" && userCtx.departmentId) {
      leadRbacFilter.departmentId = userCtx.departmentId;
    }
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

    // Search leads by customer name, destination — with RBAC
    db.lead.findMany({
      where: {
        ...leadRbacFilter,
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

    // Search conversations by customer name — with RBAC via lead
    db.conversation.findMany({
      where: {
        lead: {
          ...leadRbacFilter,
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

  // Filter out conversations without a lead — search is lead-scoped
  const conversationsWithLead = conversations.filter(
    (c): c is typeof c & { lead: { customer: { name: string } } } => c.lead !== null
  );

  return { customers, leads, conversations: conversationsWithLead };
}
