// src/modules/intake/assignment/fallback.ts

/**
 * Fallback assignment ladder (Phase 6a, T29).
 *
 * Called when the tenant's configured strategy returns null (no eligible
 * specialist is available). Tries assignments in descending specificity:
 *
 *   1. Department round-robin — if any active, non-on-leave AGENT exists in
 *      the payload's department, pick one via the standard cursor.
 *
 *   2. COMPANY_ADMIN escalation — if no AGENT is eligible, assign to the
 *      first (by createdAt) active COMPANY_ADMIN and fan out an
 *      ASSIGNMENT_FALLBACK notification to ALL active COMPANY_ADMINs so
 *      every admin is aware the staffing pipeline needs attention.
 *
 *   3. Hard failure — if there is also no active COMPANY_ADMIN, throw a
 *      descriptive error containing the tenantId so the caller can surface
 *      it in alerting / logs.
 *
 * The reason string is included in the return value so the orchestrator can
 * record it in the LeadActivity content for post-incident review.
 */

import { prisma } from "@/lib/prisma";
import { getEligibleAgents } from "./eligible";
import { nextAgentFromCursor } from "./cursor";

export interface FallbackResult {
  agentId: string;
  reason: string;
}

export async function fallbackAssign(
  tenantId: string,
  departmentId: string | undefined
): Promise<FallbackResult> {
  // ── Step 1: try eligible agents in the department ──────────────────────────
  const eligible = await getEligibleAgents(tenantId, departmentId);
  if (eligible.length) {
    const id = await nextAgentFromCursor(
      tenantId,
      `dept:${departmentId ?? "none"}`,
      eligible.map((a) => a.id).sort()
    );
    if (id) return { agentId: id, reason: "fallback:dept-rr" };
  }

  // ── Step 2: escalate to COMPANY_ADMINs ────────────────────────────────────
  const admins = await prisma.user.findMany({
    where: { tenantId, role: "COMPANY_ADMIN", isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" }, // deterministic — earliest-created admin is primary assignee
  });

  if (!admins.length) {
    throw new Error(
      `fallbackAssign: no active COMPANY_ADMIN available for tenant ${tenantId}`
    );
  }

  // Fan ASSIGNMENT_FALLBACK notification to every admin so they're all alerted.
  await Promise.all(
    admins.map((a) =>
      prisma.notification.create({
        data: {
          tenantId,
          userId: a.id,
          type: "ASSIGNMENT_FALLBACK",
          title: `Lead routed to admin: no active agents in ${departmentId ?? "(no dept)"}`,
          body: `Assignment ladder exhausted — review department staffing for ${
            departmentId ?? "unassigned"
          }.`,
          data: { departmentId: departmentId ?? null, severity: "HIGH" },
        },
      })
    )
  );

  return { agentId: admins[0].id, reason: "fallback:company-admin" };
}
