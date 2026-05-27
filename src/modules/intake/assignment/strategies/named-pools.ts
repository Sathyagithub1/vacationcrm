// src/modules/intake/assignment/strategies/named-pools.ts

/**
 * Named-pools assignment strategy (Phase 6a, T28).
 *
 * Routes leads to a pre-configured pool of agents based on lead source or
 * department. Pools are ordered by `priority` (DESC) so that higher-priority
 * specialised pools take precedence over general-purpose ones.
 *
 * Matching rules (OR — first pool where either condition is true wins):
 *   1. `pool.sourceMatch` contains `payload.source`
 *   2. `pool.departmentId` is non-null AND matches `payload.departmentId`
 *
 * Once a matching pool is found, its agentIds are intersected with the base-
 * eligible pool (active, non-on-leave AGENTs in the tenant/department). If
 * the intersection is empty the pool is skipped and the next lower-priority
 * pool is tried. This handles stale pool membership gracefully.
 *
 * If no pool matches or all eligible intersections are empty → null (caller's
 * fallback ladder handles it).
 *
 * sourceMatch narrowing: the column type is `Json @default("[]")`. We narrow
 * it to `string[]` to avoid unsafe casts — non-string entries are dropped.
 */

import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { getEligibleAgents } from "../eligible";
import { nextAgentFromCursor } from "../cursor";

export async function namedPools(payload: IntakePayload): Promise<string | null> {
  const pools = await prisma.assignmentPool.findMany({
    where: { tenantId: payload.tenantId, isActive: true },
    orderBy: { priority: "desc" },
  });

  if (!pools.length) return null;

  const base = await getEligibleAgents(payload.tenantId, payload.departmentId);
  const baseIds = new Set(base.map((a) => a.id));

  for (const pool of pools) {
    // Narrow JSON sourceMatch to string[].
    const sources = Array.isArray(pool.sourceMatch)
      ? pool.sourceMatch.filter((s): s is string => typeof s === "string")
      : [];

    const matchesSource = sources.includes(payload.source);
    const matchesDept =
      pool.departmentId !== null &&
      payload.departmentId !== undefined &&
      pool.departmentId === payload.departmentId;

    if (!matchesSource && !matchesDept) continue;

    // Intersect pool membership with eligible agents; sort for cursor determinism.
    const eligibleInPool = pool.agentIds.filter((id) => baseIds.has(id)).sort();
    if (!eligibleInPool.length) continue;

    return nextAgentFromCursor(payload.tenantId, `pool:${pool.id}`, eligibleInPool);
  }

  return null;
}
