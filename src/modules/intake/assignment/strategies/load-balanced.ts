// src/modules/intake/assignment/strategies/load-balanced.ts

/**
 * Load-balanced assignment strategy (Phase 6a, T25).
 *
 * Picks the agent with the fewest *open* leads, breaking ties by who was
 * least recently assigned (oldest `updated_at` among their leads wins, i.e.
 * they haven't had recent activity — Least Recent Activity tiebreaker).
 *
 * "Open" is defined by the stage slug NOT being in the closed-slug set below.
 * There is no `Lead.status` column in this schema; PipelineStage.slug is the
 * authoritative indicator of closed/won/lost state.
 *
 * Conventional closed stage slugs in this codebase: won, lost, cancelled, closed.
 * Add more as the product grows; this list lives here so it's a single place
 * to update.
 *
 * Tiebreaker note: `Lead.assignedAt` does not exist; `Lead.updated_at` is used
 * as a proxy for "last assignment activity" — a lead's updated_at advances
 * whenever it is assigned or otherwise modified, making it a reasonable signal.
 *
 * Raw SQL is used for the aggregate query because Prisma ORM does not support
 * LEFT JOIN + COUNT natively. Parameterised via Prisma.sql — NO $queryRawUnsafe.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { IntakePayload } from "../../types";

/** Stage slugs that indicate a closed/terminal lead state. */
const CLOSED_STAGE_SLUGS = ["won", "lost", "cancelled", "closed"];

// MAINTENANCE NOTE: this raw SQL references mapped database column names
// directly (u.is_active, u.on_leave_until, u.department_id, u.tenant_id,
// l.assigned_to, l.stage_id, l.updated_at, ps.slug, ps.tenant_id). If any
// of those columns is renamed in a future migration, this query must be
// updated by hand — Prisma cannot type-check raw SQL.
export async function loadBalanced(payload: IntakePayload): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id
    FROM users u
    LEFT JOIN leads l
      ON l.assigned_to = u.id
      AND l.stage_id IN (
        SELECT id FROM pipeline_stages
        WHERE tenant_id = u.tenant_id
          AND slug NOT IN (${Prisma.join(CLOSED_STAGE_SLUGS)})
      )
    WHERE u.tenant_id = ${payload.tenantId}
      AND u.role = 'AGENT'::"Role"
      AND u.is_active = true
      AND (u.on_leave_until IS NULL OR u.on_leave_until < now())
      ${payload.departmentId
        ? Prisma.sql`AND u.department_id = ${payload.departmentId}`
        : Prisma.empty}
    GROUP BY u.id
    ORDER BY COUNT(l.id) ASC, MAX(l.updated_at) ASC NULLS FIRST
    LIMIT 1
  `);

  return rows[0]?.id ?? null;
}
