// src/modules/intake/assignment/index.ts

/**
 * Assignment orchestrator (Phase 6a, T30).
 *
 * Reads the tenant's AssignmentStrategy and dispatches to the appropriate
 * strategy function. If no strategy is configured, or if the strategy returns
 * null (no match), the fallback ladder is invoked.
 *
 * After a successful assignment the orchestrator:
 *   1. Updates `Lead.assignedTo` with the chosen agent id.
 *   2. Writes a `LeadActivity` record with type ASSIGNMENT so the audit trail
 *      captures which strategy ran and why the specific agent was chosen.
 *
 * Precondition: `payload.leadId` must be present (dispatch stage must run
 * before assignment). Throws immediately if leadId is absent to surface
 * pipeline ordering bugs early.
 *
 * The function signature conforms to `IntakeStage` so it plugs directly into
 * the intake pipeline without a wrapper.
 */

import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { roundRobin } from "./strategies/round-robin";
import { loadBalanced } from "./strategies/load-balanced";
import { skillBased } from "./strategies/skill-based";
import { aiTiered } from "./strategies/ai-tiered";
import { namedPools } from "./strategies/named-pools";
import { fallbackAssign } from "./fallback";

const strategyFnMap = {
  ROUND_ROBIN: roundRobin,
  LOAD_BALANCED: loadBalanced,
  SKILL_BASED: skillBased,
  AI_TIERED: aiTiered,
  NAMED_POOLS: namedPools,
} as const;

export async function assignLead(payload: IntakePayload): Promise<IntakePayload> {
  if (!payload.leadId) {
    throw new Error(
      "assignLead: leadId required (dispatch must run before assignment)"
    );
  }

  const strategy = await prisma.assignmentStrategy.findUnique({
    where: { tenantId: payload.tenantId },
  });

  let assignee: string | null = null;
  let reason = "no-strategy";

  if (strategy) {
    const fn = strategyFnMap[strategy.type];
    assignee = await fn(payload);
    reason = `strategy:${strategy.type}`;
  }

  if (!assignee) {
    const fb = await fallbackAssign(payload.tenantId, payload.departmentId);
    assignee = fb.agentId;
    reason = fb.reason;
  }

  // Persist assignment and audit trail.
  // tenantId is included in the where clause to prevent cross-tenant lead
  // reassignment: if a crafted payload carries a leadId belonging to a
  // different tenant, Prisma throws P2025 (RecordNotFound) rather than
  // silently overwriting the foreign record.
  await prisma.lead.update({
    where: { id: payload.leadId, tenantId: payload.tenantId },
    data: { assignedTo: assignee },
  });

  await prisma.leadActivity.create({
    data: {
      tenantId: payload.tenantId,
      leadId: payload.leadId,
      type: "ASSIGNMENT",
      content: {
        strategy: strategy?.type ?? "NONE",
        reason,
        assigneeId: assignee,
      },
    },
  });

  return payload;
}
