/**
 * src/lib/telephony/index.ts
 *
 * Telephony provider factory (Phase 6d / 6f).
 *
 * Resolves the active TelephonyProvider for a given tenant based on the
 * tenant's `telephonyProvider` DB field.
 *
 * Supported providers:
 *   - "exotel"  → ExotelAdapter
 *   - "plivo"   → PlivoAdapter
 *   - "twilio"  → TwilioAdapter
 *   - "frejun"  → FreJunAdapter
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
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import type { TelephonyProvider } from "./types";
import { ExotelAdapter } from "./exotel";
import { PlivoAdapter } from "./plivo";
import { TwilioAdapter } from "./twilio";
import { FreJunAdapter } from "./frejun";
import type { FreJunCredentials } from "./frejun";

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

  // Phase 6h — decrypt BOTH apiKey and apiSecret at read time. The earlier
  // assumption that telephonyApiKey is "not a secret" was wrong: for Exotel
  // we now bundle {accountSid, apiKey, apiToken} into telephonyApiKey as a
  // JSON blob (per the Phase 6f wire format) and Phase 6g encrypts it on
  // write. Without this decrypt the adapters fail to parse a v1:... blob.
  //
  // NEVER log the decrypted values.
  const apiKey = decryptIfEncrypted(tenant.telephonyApiKey);
  const apiSecret = decryptIfEncrypted(tenant.telephonyApiSecret);

  switch (provider) {
    case "exotel":
      return new ExotelAdapter(apiKey, apiSecret);

    case "plivo":
      return new PlivoAdapter(apiKey, apiSecret);

    case "twilio":
      return new TwilioAdapter(apiKey, apiSecret);

    case "frejun": {
      // FreJun stores all credentials (apiToken, callerNumber, webhookSecret)
      // as an encrypted JSON string in telephonyApiKey.
      // telephonyApiSecret is not used for FreJun but must be non-empty to pass
      // the credential-completeness guard above.
      let parsed: FreJunCredentials & { webhookSecret: string };
      try {
        parsed = JSON.parse(apiKey) as FreJunCredentials & { webhookSecret: string };
      } catch {
        throw new Error(
          `[telephony] FreJun telephonyApiKey for tenant ${tenantId} is not valid JSON. ` +
            "Expected: { apiToken, callerNumber?, webhookSecret }",
        );
      }
      if (!parsed.apiToken || !parsed.webhookSecret) {
        throw new Error(
          `[telephony] FreJun credentials incomplete for tenant ${tenantId}. ` +
            "telephonyApiKey JSON must contain apiToken and webhookSecret.",
        );
      }
      return new FreJunAdapter(
        { apiToken: parsed.apiToken, callerNumber: parsed.callerNumber },
        parsed.webhookSecret,
      );
    }

    default:
      throw new Error(
        `[telephony] Unknown telephony provider "${tenant.telephonyProvider}" ` +
          `for tenant ${tenantId}. Supported: exotel, plivo, twilio, frejun`,
      );
  }
}
