// src/modules/intake/assignment/strategies/round-robin.ts

/**
 * Round-robin assignment strategy (Phase 6a, T24).
 *
 * Selects the next eligible agent for the tenant/department using a
 * persistent round-robin cursor backed by an advisory-locked Postgres
 * transaction. This guarantees deterministic, collision-free distribution
 * even under concurrent intake events.
 *
 * Agent pool:
 *   - All active, non-on-leave AGENT users in the payload's department.
 *   - Sorted by id for deterministic ordering across calls (findMany does
 *     not guarantee order without orderBy).
 */

import type { IntakePayload } from "../../types";
import { getEligibleAgents } from "../eligible";
import { nextAgentFromCursor } from "../cursor";

export async function roundRobin(payload: IntakePayload): Promise<string | null> {
  const agents = await getEligibleAgents(payload.tenantId, payload.departmentId);
  if (!agents.length) return null;

  // Sort ids for deterministic round-robin order; findMany ordering is not stable.
  const ids = agents.map((a) => a.id).sort();
  return nextAgentFromCursor(
    payload.tenantId,
    `dept:${payload.departmentId ?? "none"}`,
    ids
  );
}
