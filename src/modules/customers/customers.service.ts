import type { PrismaClient } from "@prisma/client";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

interface FindOrCreateData {
  name: string;
  mobile: string;
  email?: string | null;
  tenantId: string;
}

/**
 * Deduplicate by mobile within tenant.
 * If customer with same mobile exists, update name/email if provided and return.
 * If not, create new customer.
 */
export async function findOrCreateCustomer(db: TenantDb, data: FindOrCreateData) {
  const existing = await db.customer.findFirst({
    where: { mobile: data.mobile },
  });

  if (existing) {
    // Update name/email if newer values provided
    const updates: Record<string, string> = {};
    if (data.name && data.name !== existing.name) updates.name = data.name;
    if (data.email && data.email !== existing.email) updates.email = data.email;

    if (Object.keys(updates).length > 0) {
      return db.customer.update({
        where: { id: existing.id },
        data: updates,
      });
    }

    return existing;
  }

  return (db.customer.create as Function)({
    data: {
      name: data.name,
      mobile: data.mobile,
      email: data.email || null,
    },
  });
}

/**
 * Recalculate totalLeads and lastLeadDate from leads table.
 */
export async function updateCustomerStats(db: TenantDb, customerId: string) {
  const stats = await db.lead.aggregate({
    where: { customerId },
    _count: { id: true },
    _max: { createdAt: true },
  });

  return db.customer.update({
    where: { id: customerId },
    data: {
      totalLeads: stats._count.id,
      lastLeadDate: stats._max.createdAt,
    },
  });
}
