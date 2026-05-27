// src/modules/intake/assignment/cursor.ts

/**
 * Advisory-lock round-robin cursor (Phase 6a, T24).
 *
 * Implements a concurrency-safe "next agent" cursor using Postgres advisory
 * locks so that concurrent intake events for the same tenant+scope don't
 * hand off to the same agent twice.
 *
 * Lock key derivation: we hash `tenantId:scope` to a positive bigint that
 * fits in Postgres's bigint range (< 2^63). The hash is a simple polynomial
 * roll — collision probability is negligible for typical tenant/scope counts.
 *
 * Note on bigint interpolation: Prisma.sql interpolates JavaScript bigint
 * values correctly via the parameterized protocol. The `::bigint` cast in
 * the SQL ensures Postgres treats the value as bigint. We do NOT use
 * $queryRawUnsafe to avoid SQL injection.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/** Derives a positive bigint advisory-lock key from a tenantId + scope string. */
function lockKey(tenantId: string, scope: string): bigint {
  const PRIME = BigInt(131);
  const MASK = (BigInt(1) << BigInt(63)) - BigInt(1);
  let h = BigInt(0);
  for (const ch of `${tenantId}:${scope}`) {
    h = (h * PRIME + BigInt(ch.charCodeAt(0))) & MASK;
  }
  return h;
}

/**
 * Picks the next agentId from `agentIds` in round-robin order, advancing the
 * `AssignmentCursor` for `(tenantId, scope)` under an advisory transaction lock
 * so concurrent callers don't produce duplicate assignments.
 *
 * Returns null if `agentIds` is empty.
 */
export async function nextAgentFromCursor(
  tenantId: string,
  scope: string,
  agentIds: string[]
): Promise<string | null> {
  if (!agentIds.length) return null;

  return prisma.$transaction(async (tx) => {
    const key = lockKey(tenantId, scope);

    // Acquire a transaction-scoped advisory lock. pg_advisory_xact_lock
    // serialises concurrent calls that hash to the same key, ensuring the
    // cursor read-modify-write is atomic. We use $executeRaw (not $queryRaw)
    // because pg_advisory_xact_lock returns void — Prisma's $queryRaw rejects
    // void result columns.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${key}::bigint)`
    );

    const cursor = await tx.assignmentCursor.findUnique({
      where: { tenantId_scope: { tenantId, scope } },
    });

    const lastIdx = cursor?.lastAgentId
      ? agentIds.indexOf(cursor.lastAgentId)
      : -1;

    // If lastAgentId is no longer in the list (removed agent), start from 0.
    const nextIdx = (lastIdx + 1) % agentIds.length;
    const pick = agentIds[nextIdx];

    await tx.assignmentCursor.upsert({
      where: { tenantId_scope: { tenantId, scope } },
      update: { lastAgentId: pick },
      create: { tenantId, scope, lastAgentId: pick },
    });

    return pick;
  });
}
