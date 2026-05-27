// src/modules/intake/assignment/eligible.ts

/**
 * Eligible-agent pool query (Phase 6a, T23) — supporting utility for the
 * assignment stage.
 *
 * Returns every User in the tenant that is:
 *   - role === AGENT
 *   - isActive === true
 *   - NOT currently on leave (onLeaveUntil is null or in the past)
 *   - In the specified department, when departmentId is provided.
 *
 * Only the fields needed by the assignment strategies are selected to keep
 * the result set lean.
 *
 * Cross-tenant safety: tenantId is always applied as a filter even though
 * User.id is a global UUID, preventing a payload from one tenant from
 * resolving agents belonging to another.
 */

import { prisma } from "@/lib/prisma";

export interface EligibleAgent {
  id: string;
  languages: string[];
  tags: string[];
  assignmentTier: number | null;
  departmentId: string | null;
}

export async function getEligibleAgents(
  tenantId: string,
  departmentId: string | undefined
): Promise<EligibleAgent[]> {
  const now = new Date();
  return prisma.user.findMany({
    where: {
      tenantId,
      role: "AGENT",
      isActive: true,
      ...(departmentId ? { departmentId } : {}),
      OR: [{ onLeaveUntil: null }, { onLeaveUntil: { lt: now } }],
    },
    select: {
      id: true,
      languages: true,
      tags: true,
      assignmentTier: true,
      departmentId: true,
    },
  });
}
