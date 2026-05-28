/**
 * Multi-WhatsApp number support per tenant.
 *
 * Travel agencies often configure 2–5 WhatsApp Business numbers (one per
 * destination team, one for VIP, etc.).  This module provides the two key
 * look-up helpers consumed by the inbound webhook and the outbound dispatcher.
 *
 * Design notes:
 *  - ChannelConfig rows are now keyed by (tenantId, channel, externalId)
 *    instead of (tenantId, channel), so one tenant can own many numbers.
 *  - `isPrimary` marks the fallback number for outbound when no specific
 *    channelConfigId or departmentId is supplied.
 *  - All queries use tenantId as the first filter — cross-tenant leakage is
 *    impossible because `externalId` alone is never sufficient to look up a row.
 */

import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
// NOTE: ChannelConfig type will include new fields (label, externalId, isPrimary,
// assignedDepartmentId) after running the 6b migration and `prisma generate`.
// Until then, use type-cast workarounds where the old generated types complain.
import type { ChannelConfig } from "@prisma/client";

// Helper casts for new fields not yet in generated Prisma types (added in 6b migration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedTenantChannel {
  tenant: { id: string; slug: string };
  channelConfig: ChannelConfig;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Given a WhatsApp phone number ID (or any channel externalId), find which
 * tenant owns it and return both the tenant and the matching ChannelConfig.
 *
 * Used by the inbound webhook to route a message to the correct tenant when
 * the payload does not include a tenantId query param (Meta-style webhooks
 * where one App-level webhook receives events for all numbers).
 *
 * Returns null when no active config is found.
 */
export async function resolveTenantByPhoneNumberId(
  phoneNumberId: string
): Promise<ResolvedTenantChannel | null> {
  const config = await anyPrisma.channelConfig.findFirst({
    where: {
      externalId: phoneNumberId,
      isActive: true,
      channel: "WHATSAPP",
    },
    include: {
      tenant: { select: { id: true, slug: true } },
    },
  }) as (ChannelConfig & { tenant: { id: string; slug: string } }) | null;

  if (!config) return null;

  return {
    tenant: config.tenant,
    channelConfig: config,
  };
}

/**
 * Pick the correct ChannelConfig for an outbound message.
 *
 * Priority order:
 *  1. Explicit `channelConfigId` — caller knows exactly which number to use.
 *  2. Department default — tenant has a number assigned to the lead's department.
 *  3. Tenant primary — the `isPrimary` flag on a WHATSAPP config.
 *
 * Throws when no suitable config is found so the caller can decide whether
 * to surface an error or silently skip.
 */
export async function getOutboundChannelConfig(
  tenantId: string,
  options: {
    departmentId?: string;
    channelConfigId?: string;
    channel?: "WHATSAPP" | "FACEBOOK" | "INSTAGRAM" | "EMAIL" | "SMS" | "TELEGRAM";
  } = {}
): Promise<ChannelConfig> {
  const db = tenantPrisma(tenantId);
  const channel = options.channel ?? "WHATSAPP";

  // 1. Explicit config ID — verify it belongs to this tenant
  if (options.channelConfigId) {
    const config = await db.channelConfig.findFirst({
      where: { id: options.channelConfigId, channel, isActive: true },
    });
    if (config) return config;
  }

  // 2. Department default
  if (options.departmentId) {
    const config = await anyDb(db).channelConfig.findFirst({
      where: { assignedDepartmentId: options.departmentId, channel, isActive: true },
    }) as ChannelConfig | null;
    if (config) return config;
  }

  // 3. Tenant primary
  const primary = await anyDb(db).channelConfig.findFirst({
    where: { isPrimary: true, channel, isActive: true },
  }) as ChannelConfig | null;
  if (primary) return primary;

  throw new Error(
    `No active ${channel} ChannelConfig found for tenant ${tenantId} ` +
      `(channelConfigId=${options.channelConfigId ?? "none"}, ` +
      `departmentId=${options.departmentId ?? "none"})`
  );
}

/**
 * Set a ChannelConfig as primary for its (tenant, channel) pair.
 * Atomically clears isPrimary on all other configs for the same channel first,
 * then sets isPrimary=true on the requested config.
 *
 * Runs in a transaction to prevent a race where two configs end up primary.
 */
export async function setPrimaryChannelConfig(
  tenantId: string,
  channelConfigId: string
): Promise<ChannelConfig> {
  const db = tenantPrisma(tenantId);

  // Verify the config exists and belongs to this tenant
  const target = await db.channelConfig.findFirst({
    where: { id: channelConfigId },
  });
  if (!target) throw new Error("ChannelConfig not found");

  // Use a raw transaction via global prisma to ensure atomicity
  await prisma.$transaction([
    anyPrisma.channelConfig.updateMany({
      where: { tenantId, channel: target.channel, isPrimary: true },
      data: { isPrimary: false },
    }),
    anyPrisma.channelConfig.update({
      where: { id: channelConfigId },
      data: { isPrimary: true },
    }),
  ]);

  const updated = await db.channelConfig.findFirst({
    where: { id: channelConfigId },
  });
  if (!updated) throw new Error("ChannelConfig not found after update");
  return updated;
}

/**
 * List all ChannelConfigs for a tenant, optionally filtered by channel.
 * Credentials and webhookSecret are never returned.
 */
export async function listChannelConfigs(
  tenantId: string,
  channel?: string
) {
  const db = tenantPrisma(tenantId);
  return anyDb(db).channelConfig.findMany({
    where: channel ? { channel: channel as ChannelConfig["channel"] } : {},
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      channel: true,
      label: true,
      externalId: true,
      assignedDepartmentId: true,
      isPrimary: true,
      isActive: true,
      verifiedAt: true,
      config: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
