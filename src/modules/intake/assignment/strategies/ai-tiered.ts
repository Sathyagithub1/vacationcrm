// src/modules/intake/assignment/strategies/ai-tiered.ts

/**
 * AI-tiered assignment strategy (Phase 6a, T27).
 *
 * Routes leads to agents based on the lead's AI-computed score (LeadScore.score)
 * and a configurable tier structure stored in AssignmentStrategy.config:
 *
 *   { tierCount: 3, cutoffs: [80, 40] }
 *
 * Tier computation (cutoffs sorted DESC):
 *   score >= cutoffs[0] → tier 1  (premium agents)
 *   score >= cutoffs[1] → tier 2  (mid-tier agents)
 *   else               → tier N  (general pool)
 *
 * Cascade behaviour: if no agent with the computed tier is eligible, the
 * strategy tries tier+1, tier+2, … until it finds eligible agents or exhausts
 * all tiers, at which point it returns null (caller's fallback ladder takes over).
 *
 * Within the selected tier, round-robin is used (via nextAgentFromCursor) for
 * equitable distribution — a simpler choice than load-balanced because tier
 * membership already implies a comparable skill level, making open-lead counts
 * a secondary concern.
 *
 * If no LeadScore row exists for the lead, the lead is placed in the lowest
 * tier to protect premium-tier agents from unscored leads. Same behaviour
 * when no leadId is present.
 *
 * LeadScore field: `score: Int` (verified against Phase 5 schema).
 */

import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../../types";
import { getEligibleAgents } from "../eligible";
import { nextAgentFromCursor } from "../cursor";

interface TieredConfig {
  tierCount: number;
  cutoffs: number[];
}

/**
 * Returns 1-based tier number for the given score.
 * cutoffs must be sorted DESC (highest threshold first).
 */
function computeTier(score: number, cutoffs: number[]): number {
  for (let i = 0; i < cutoffs.length; i++) {
    if (score >= cutoffs[i]) return i + 1;
  }
  return cutoffs.length + 1;
}

export async function aiTiered(payload: IntakePayload): Promise<string | null> {
  // Load strategy config; default to 3 tiers with no cutoffs if absent.
  const strategy = await prisma.assignmentStrategy.findUnique({
    where: { tenantId: payload.tenantId },
  });
  const cfg = (strategy?.config ?? {}) as Partial<TieredConfig>;
  const tierCount = typeof cfg.tierCount === "number" ? cfg.tierCount : 3;
  const cutoffs = Array.isArray(cfg.cutoffs)
    ? cfg.cutoffs.filter((c): c is number => typeof c === "number")
    : [];

  // Determine the tier for this lead.
  let pickedTier: number;
  if (!payload.leadId) {
    // No lead context — route to lowest (most-permissive) tier.
    pickedTier = tierCount;
  } else {
    const leadScore = await prisma.leadScore.findUnique({
      where: { leadId: payload.leadId },
    });
    pickedTier = leadScore ? computeTier(leadScore.score, cutoffs) : tierCount;
  }

  const base = await getEligibleAgents(payload.tenantId, payload.departmentId);

  // Cascade from pickedTier down to tierCount.
  for (let tier = pickedTier; tier <= tierCount; tier++) {
    const pool = base
      .filter((a) => a.assignmentTier === tier)
      .map((a) => a.id)
      .sort();

    if (pool.length) {
      const scope = `dept:${payload.departmentId ?? "none"}:tier:${tier}`;
      return nextAgentFromCursor(payload.tenantId, scope, pool);
    }
  }

  return null;
}
