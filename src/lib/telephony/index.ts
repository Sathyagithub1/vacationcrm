/**
 * src/lib/telephony/index.ts
 *
 * Telephony provider factory (Phase 6d).
 *
 * Resolves the active TelephonyProvider for a given tenant based on the
 * tenant's `telephonyProvider` DB field.
 *
 * Supported providers:
 *   - "exotel"  → ExotelAdapter
 *   - "plivo"   → PlivoAdapter
 *   - "twilio"  → TwilioAdapter
 *
 * Cross-tenant isolation:
 *   Credentials are always loaded by tenantId and never shared across tenants.
 *   Keys are never logged.
 *
 * Errors:
 *   Throws with a tenant-id-tagged message if:
 *   - tenant not found
 *   - telephonyProvider is null/unset
 *   - telephonyApiKey or telephonyApiSecret is missing
 *   - provider value is unrecognised
 */

import { prisma } from "@/lib/prisma";
import type { TelephonyProvider } from "./types";
import { ExotelAdapter } from "./exotel";
import { PlivoAdapter } from "./plivo";
import { TwilioAdapter } from "./twilio";

// Re-export types so consumers can import from one place.
export type { TelephonyProvider } from "./types";
export { NotImplementedError } from "./types";

/**
 * Load and return the TelephonyProvider configured for the given tenant.
 *
 * @throws Error  if the tenant has no telephony provider configured.
 */
export async function getTelephonyProvider(
  tenantId: string,
): Promise<TelephonyProvider> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      telephonyProvider: true,
      telephonyApiKey: true,
      telephonyApiSecret: true,
    },
  });

  if (!tenant) {
    throw new Error(`[telephony] Tenant not found: ${tenantId}`);
  }

  if (!tenant.telephonyProvider) {
    throw new Error(
      `[telephony] No telephony provider configured for tenant ${tenantId}`,
    );
  }

  if (!tenant.telephonyApiKey || !tenant.telephonyApiSecret) {
    throw new Error(
      `[telephony] Telephony credentials incomplete for tenant ${tenantId} ` +
        `(provider=${tenant.telephonyProvider})`,
    );
  }

  const provider = tenant.telephonyProvider.toLowerCase();

  switch (provider) {
    case "exotel":
      return new ExotelAdapter(tenant.telephonyApiKey, tenant.telephonyApiSecret);

    case "plivo":
      return new PlivoAdapter(tenant.telephonyApiKey, tenant.telephonyApiSecret);

    case "twilio":
      return new TwilioAdapter(tenant.telephonyApiKey, tenant.telephonyApiSecret);

    default:
      throw new Error(
        `[telephony] Unknown telephony provider "${tenant.telephonyProvider}" ` +
          `for tenant ${tenantId}. Supported: exotel, plivo, twilio`,
      );
  }
}
