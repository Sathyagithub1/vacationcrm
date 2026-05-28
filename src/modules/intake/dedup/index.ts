// src/modules/intake/dedup/index.ts

/**
 * Strict-merge dedup with per-phone advisory lock (Phase 6e, B7 fix).
 *
 * Looks up the most recent Lead for the tenant whose Customer matches either
 * the incoming phone OR email. On match, appends a REPEAT_INQUIRY LeadActivity
 * and sets `dedupResult` on the payload so the pipeline orchestrator can
 * short-circuit before dispatch creates a duplicate Lead.
 *
 * Concurrency safety (B7):
 *   Without a lock, two concurrent intakes for the same phone can both pass
 *   dedupCheck (see no existing Customer) and proceed to dispatch, where
 *   both create a Lead for the newly-written Customer.  This produced ~98 Leads
 *   for 50 unique phones under a 100-concurrent load test.
 *
 *   Fix: take `pg_advisory_xact_lock` on hash(tenantId:phone:phone) at the
 *   start of the transaction.  Postgres serialises concurrent transactions that
 *   share the same lock key, so the second intake for the same phone waits until
 *   the first has either committed (Customer + Lead now visible) or rolled back.
 *   The second intake's Lead.findFirst then finds the existing Lead and short-
 *   circuits via REPEAT_INQUIRY instead of creating a duplicate.
 *
 *   Email-only intakes skip the lock (rare in practice; email burst is much
 *   lower than phone burst, and email has no production-volume equivalent of
 *   Meta Lead Ads bursts).
 *
 * Schema notes:
 *  - Canonical payload key is `phone`; the Customer column is `mobile`.
 *  - Customer.email is nullable (partial unique on tenant+email WHERE NOT NULL).
 *  - LeadActivity has no `source` or `meta` columns — contextual info goes
 *    into the single `content: Json` field.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { IntakePayload } from "../types";

// ── Advisory-lock key derivation ──────────────────────────────────────────────

/**
 * Derives a positive bigint advisory-lock key from tenantId + phone.
 *
 * Uses the same polynomial-hash approach as the round-robin cursor so the
 * pattern is consistent across the codebase.  Collision probability is
 * negligible for typical tenant+phone cardinalities.
 *
 * The prefix "phone:" disambiguates from other advisory-lock namespaces
 * (e.g. the round-robin cursor uses tenantId:scope without the "phone:" part).
 */
function phoneLockKey(tenantId: string, phone: string): bigint {
  const PRIME = BigInt(131);
  const MASK = (BigInt(1) << BigInt(63)) - BigInt(1);
  let h = BigInt(0);
  for (const ch of `${tenantId}:phone:${phone}`) {
    h = (h * PRIME + BigInt(ch.charCodeAt(0))) & MASK;
  }
  return h;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check for a duplicate intake and short-circuit if found.
 *
 * When a phone number is present, wraps the entire check in a Postgres
 * transaction and acquires a per-(tenant, phone) advisory transaction lock
 * before reading.  This serialises concurrent intakes for the same phone and
 * eliminates the read-before-write race that caused duplicate Leads.
 *
 * Returns `payload` unchanged if no duplicate is found.
 * Returns `payload` with `dedupResult` set if a duplicate is found.
 */
export async function dedupCheck(payload: IntakePayload): Promise<IntakePayload> {
  const phone = payload.canonicalFields?.phone ?? payload.sender.phone;
  const email = payload.canonicalFields?.email ?? payload.sender.email;
  if (!phone && !email) return payload;

  // If we have a phone, run inside a transaction with an advisory lock so that
  // concurrent intakes for the same (tenant, phone) are serialised.
  // If we only have an email, best-effort dedup without the lock.
  if (phone) {
    return prisma.$transaction(async (tx) => {
      const key = phoneLockKey(payload.tenantId, phone);
      // pg_advisory_xact_lock is void — use $executeRaw, not $queryRaw.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${key}::bigint)`,
      );

      return runDedupLogic(payload, phone, email, tx);
    });
  }

  // Email-only path: no lock, best-effort dedup.
  return runDedupLogic(payload, phone, email, prisma);
}

// ── Internal dedup logic ──────────────────────────────────────────────────────

/**
 * Core dedup query + REPEAT_INQUIRY creation.
 * Accepts either the global `prisma` client or a transaction client (`tx`)
 * so the lock and the reads are in the same DB session when using a transaction.
 */
async function runDedupLogic(
  payload: IntakePayload,
  phone: string | undefined,
  email: string | undefined,
  client: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
): Promise<IntakePayload> {
  const orClauses: Prisma.CustomerWhereInput[] = [];
  if (phone) orClauses.push({ mobile: phone });
  if (email) orClauses.push({ email });

  const existing = await client.lead.findFirst({
    where: {
      tenantId: payload.tenantId,
      customer: { OR: orClauses },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) return payload;

  await client.leadActivity.create({
    data: {
      tenantId: payload.tenantId,
      leadId: existing.id,
      type: "REPEAT_INQUIRY",
      content: {
        source: payload.source,
        rawPayload: payload.rawPayload as Prisma.InputJsonValue,
        intakeFormId: payload.intakeFormId ?? null,
      },
    },
  });

  return {
    ...payload,
    dedupResult: {
      existingLeadId: existing.id,
      existingCustomerId: existing.customerId,
    },
  };
}
