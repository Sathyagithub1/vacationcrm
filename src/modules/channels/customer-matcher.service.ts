import type { ConversationChannel } from "@prisma/client";

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export interface MatchedCustomer {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
}

/**
 * Looks up or creates a Customer record keyed by (tenantId, channel, externalId).
 *
 * Resolution order:
 *  1. Exact match on customer_channels (externalId + channel).
 *  2. Phone match on customers table (when externalId looks like a phone number).
 *  3. Email match on customers table (when externalId contains "@").
 *  4. Create new customer + customer_channel entry.
 */
export async function matchOrCreateCustomer(
  db: TenantDb,
  tenantId: string,
  channel: ConversationChannel,
  externalId: string,
  senderName?: string
): Promise<MatchedCustomer> {
  // Step 1: Exact lookup via customer_channels
  const existing = await db.customerChannel.findFirst({
    where: { channel, externalId },
    include: { customer: true },
  });

  if (existing) {
    // Touch lastSeenAt
    await db.customerChannel.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
    return existing.customer as MatchedCustomer;
  }

  // Step 2: Phone match — externalId without "+" prefix is digits only
  const digitsOnly = externalId.replace(/\D/g, "");
  let matchedCustomer: MatchedCustomer | null = null;

  if (digitsOnly.length >= 7) {
    const byPhone = await db.customer.findFirst({
      where: {
        OR: [
          { mobile: externalId },
          { mobile: digitsOnly },
          { mobile: `+${digitsOnly}` },
        ],
      },
    });
    if (byPhone) matchedCustomer = byPhone as MatchedCustomer;
  }

  // Step 3: Email match
  if (!matchedCustomer && externalId.includes("@")) {
    const byEmail = await db.customer.findFirst({
      where: { email: externalId.toLowerCase() },
    });
    if (byEmail) matchedCustomer = byEmail as MatchedCustomer;
  }

  if (matchedCustomer) {
    // Register this channel identity against the existing customer
    await db.customerChannel.create({
      data: {
        customerId: matchedCustomer.id,
        channel,
        externalId,
        displayName: senderName ?? null,
        lastSeenAt: new Date(),
      },
    });
    return matchedCustomer;
  }

  // Step 4: Create new customer + link channel
  const displayName = senderName?.trim() || `${channel} User`;
  const mobileFallback = digitsOnly.length >= 7 ? `+${digitsOnly}` : externalId;
  const emailFallback = externalId.includes("@") ? externalId.toLowerCase() : null;

  const newCustomer = await db.customer.create({
    data: {
      name: displayName,
      mobile: mobileFallback,
      email: emailFallback,
      channels: {
        create: {
          channel,
          externalId,
          displayName: senderName ?? null,
          lastSeenAt: new Date(),
          // tenantId injected by tenantPrisma extension
        },
      },
    },
  });

  return newCustomer as MatchedCustomer;
}
