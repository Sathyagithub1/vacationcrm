/**
 * Broadcast audience helpers — tag-based segmentation.
 *
 * Supports two audience expansion strategies:
 *  - "CUSTOMER" scope: customers whose tagIds contain ALL of the provided tagIds
 *  - "LEAD" scope: customers who have at least one lead whose tagIds contain ALL tagIds
 *
 * All queries are tenant-scoped. Cross-tenant data leakage is structurally
 * impossible because tenantPrisma() prepends tenantId to every query.
 */

import { tenantPrisma } from "@/lib/prisma";
import type { Customer } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AudienceScope = "CUSTOMER" | "LEAD";

export interface AudiencePreview {
  count: number;
  sampleCustomers: Pick<Customer, "id" | "name" | "email" | "mobile">[];
}

export interface AudienceRecipient {
  customerId: string;
  /** Available contact channels for this customer (e.g., phone number for SMS/WhatsApp) */
  channels: {
    mobile?: string;
    email?: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a Prisma where clause that matches customers/leads who have ALL of
 * the provided tagIds in their tagIds array.
 *
 * Uses Prisma's `hasEvery` scalar list filter.
 * For small tag sets this is efficient enough; for large sets consider a GIN index.
 *
 * NOTE: Customer.tagIds is a new column added in 6b migration. The Prisma
 * client doesn't know about it yet — use `as any` casts at call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTagFilter(tagIds: string[]): any {
  if (tagIds.length === 0) return {};
  // Prisma scalar list filter: hasEvery is the correct operator for "contains all"
  return { tagIds: { hasEvery: tagIds } };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Preview the audience size and a small sample (up to 5 customers).
 *
 * @param tenantId    Tenant to scope the query to.
 * @param tagIds      Tag IDs to filter on (intersection — customer must have all).
 * @param scope       "CUSTOMER" filters customer.tagIds; "LEAD" filters lead.tagIds.
 */
export async function previewAudience(
  tenantId: string,
  tagIds: string[],
  scope: AudienceScope = "CUSTOMER"
): Promise<AudiencePreview> {
  const db = tenantPrisma(tenantId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerDb = db.customer as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadDb = db.lead as any;

  if (scope === "CUSTOMER") {
    const tagFilter = buildTagFilter(tagIds);
    const [count, sampleCustomers] = await Promise.all([
      customerDb.count({ where: tagFilter }),
      customerDb.findMany({
        where: tagFilter,
        take: 5,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, email: true, mobile: true },
      }),
    ]);
    return { count, sampleCustomers };
  }

  // LEAD scope: find customers who have at least one lead with all the tags
  const leads = await leadDb.findMany({
    where: buildTagFilter(tagIds),
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const customerIds = leads.map((l: { customerId: string }) => l.customerId);

  if (customerIds.length === 0) return { count: 0, sampleCustomers: [] };

  const [count, sampleCustomers] = await Promise.all([
    customerDb.count({ where: { id: { in: customerIds } } }),
    customerDb.findMany({
      where: { id: { in: customerIds } },
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, mobile: true },
    }),
  ]);

  return { count, sampleCustomers };
}

/**
 * Expand the full audience list for a broadcast send.
 * Returns one record per customer with their available contact channels.
 */
export async function expandAudience(
  tenantId: string,
  tagIds: string[],
  scope: AudienceScope = "CUSTOMER"
): Promise<AudienceRecipient[]> {
  const db = tenantPrisma(tenantId);

  let customers: Pick<Customer, "id" | "mobile" | "email">[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerDb2 = db.customer as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadDb2 = db.lead as any;

  if (scope === "CUSTOMER") {
    customers = await customerDb2.findMany({
      where: buildTagFilter(tagIds),
      select: { id: true, mobile: true, email: true },
    });
  } else {
    const leads = await leadDb2.findMany({
      where: buildTagFilter(tagIds),
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const customerIds = leads.map((l: { customerId: string }) => l.customerId);
    if (customerIds.length === 0) return [];

    customers = await customerDb2.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, mobile: true, email: true },
    });
  }

  return customers.map((c) => ({
    customerId: c.id,
    channels: {
      mobile: c.mobile || undefined,
      email: c.email || undefined,
    },
  }));
}
