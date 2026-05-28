/**
 * scripts/encrypt-tenant-credentials.ts
 *
 * One-shot CLI to encrypt existing plaintext tenant credentials at rest.
 *
 * Iterates every Tenant row and encrypts the following fields if they are not
 * already in v1 format:
 *   - razorpayKeySecret
 *   - razorpayWebhookSecret
 *   - telephonyApiSecret
 *   - sttApiKey
 *   - ttsApiKey
 *
 * Prerequisites:
 *   - CREDENTIAL_ENCRYPTION_KEY env var must be set (64 hex chars).
 *   - DATABASE_URL env var must point to the target database.
 *
 * Usage:
 *   CREDENTIAL_ENCRYPTION_KEY=<key> npx tsx scripts/encrypt-tenant-credentials.ts
 *
 * Idempotent: already-encrypted values (v1: prefix) are skipped.
 * Safe to run multiple times.
 *
 * After running:
 *   - Confirm with: npx tsx scripts/encrypt-tenant-credentials.ts --dry-run
 *     (logs what WOULD be encrypted without writing).
 *   - Update TODO_BLOCKERS.md 6C-B4 status to RESOLVED.
 */

import { PrismaClient } from "@prisma/client";
import {
  encryptCredential,
  isEncrypted,
} from "../src/lib/crypto/credential-encryption";

// ── Guards ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
  console.error(
    "ERROR: CREDENTIAL_ENCRYPTION_KEY is not set.\n" +
      "Generate a key: openssl rand -hex 32\n" +
      "Then run: CREDENTIAL_ENCRYPTION_KEY=<key> npx tsx scripts/encrypt-tenant-credentials.ts",
  );
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CredentialField =
  | "razorpayKeySecret"
  | "razorpayWebhookSecret"
  | "telephonyApiSecret"
  | "sttApiKey"
  | "ttsApiKey";

const CREDENTIAL_FIELDS: CredentialField[] = [
  "razorpayKeySecret",
  "razorpayWebhookSecret",
  "telephonyApiSecret",
  "sttApiKey",
  "ttsApiKey",
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();

  try {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        razorpayKeySecret: true,
        razorpayWebhookSecret: true,
        telephonyApiSecret: true,
        sttApiKey: true,
        ttsApiKey: true,
      },
    });

    console.log(
      `${DRY_RUN ? "[DRY RUN] " : ""}Processing ${tenants.length} tenant(s)...`,
    );

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const tenant of tenants) {
      const updates: Partial<Record<CredentialField, string>> = {};

      for (const field of CREDENTIAL_FIELDS) {
        const value = tenant[field];
        if (!value) {
          // null / undefined — nothing to encrypt
          continue;
        }
        if (isEncrypted(value)) {
          console.log(`  [SKIP]    tenant=${tenant.id} field=${field} (already v1)`);
          totalSkipped++;
          continue;
        }

        const encrypted = encryptCredential(value);
        updates[field] = encrypted;
        console.log(
          `  [${DRY_RUN ? "WOULD ENCRYPT" : "ENCRYPTING"}] tenant=${tenant.id} field=${field}`,
        );
      }

      if (Object.keys(updates).length > 0) {
        if (!DRY_RUN) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: updates,
          });
        }
        totalUpdated += Object.keys(updates).length;
      }
    }

    console.log(
      `\n${DRY_RUN ? "[DRY RUN] " : ""}Done. ` +
        `encrypted=${totalUpdated} skipped_already_encrypted=${totalSkipped}`,
    );

    if (DRY_RUN) {
      console.log(
        "\nRe-run without --dry-run to apply changes:\n" +
          "  CREDENTIAL_ENCRYPTION_KEY=<key> npx tsx scripts/encrypt-tenant-credentials.ts",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
