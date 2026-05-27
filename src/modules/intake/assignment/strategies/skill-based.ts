// src/modules/intake/assignment/strategies/skill-based.ts

/**
 * Skill-based assignment strategy (Phase 6a, T26).
 *
 * Narrows the eligible-agent pool to agents who speak the requested language
 * OR hold at least one of the requested tags. When neither language nor tags
 * are present on the payload, or when no agents match the criteria, the full
 * base-eligible pool is used as a fallback — ensuring every lead is routed
 * even when no specialist is available.
 *
 * Round-robin is applied within the selected pool via `nextAgentFromCursor`
 * so that specialists are not overloaded relative to one another.
 *
 * Scope key includes the sorted tag CSV to avoid cross-contaminating cursors
 * between different skill requirements (e.g. "luxury,vip" vs "budget").
 */

import type { IntakePayload } from "../../types";
import { getEligibleAgents } from "../eligible";
import { nextAgentFromCursor } from "../cursor";

export async function skillBased(payload: IntakePayload): Promise<string | null> {
  const base = await getEligibleAgents(payload.tenantId, payload.departmentId);
  if (!base.length) return null;

  const cf = payload.canonicalFields ?? {};
  const reqLang = typeof cf.language === "string" ? cf.language : undefined;
  const reqTags = Array.isArray(cf.tags)
    ? cf.tags.filter((t): t is string => typeof t === "string")
    : [];

  // Filter to skill-matched agents only when criteria are present.
  const filtered =
    reqLang || reqTags.length
      ? base.filter(
          (a) =>
            (reqLang ? a.languages.includes(reqLang) : false) ||
            reqTags.some((t) => a.tags.includes(t))
        )
      : base;

  // Fail-soft: fall back to base pool when no specialist matches.
  const pool = filtered.length ? filtered : base;
  const ids = pool.map((a) => a.id).sort();

  const tagKey = [...reqTags].sort().join(",");
  const scope = `dept:${payload.departmentId ?? "none"}:skill:${reqLang ?? ""}:${tagKey}`;

  return nextAgentFromCursor(payload.tenantId, scope, ids);
}
