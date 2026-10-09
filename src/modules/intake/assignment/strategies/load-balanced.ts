// src/modules/intake/assignment/strategies/load-balanced.ts

/**
 * Load-balanced assignment strategy with advisory lock (Phase 6e, B8 fix).
 *
 * Picks the agent with the fewest *open* leads, breaking ties by who was
 * least recently assigned (oldest `updated_at` among their leads wins, i.e.
 * they haven't had recent activity — Least Recent Activity tiebreaker).
 *
 * "Open" is defined by the stage slug NOT being in the closed-slug set below.
 * There is no `Lead.status` column in this schema; PipelineStage.slug is the
 * authoritative indicator of closed/won/lost state.
 *
 * ── Phase 6e B8 fix — advisory lock per (tenant, department) ────────────────
 *
 * Without a lock, 100 concurrent intakes all read the same "all agents have 0
 * open leads" snapshot (before any write commits), converge on the same
 * tiebreaker winner, and produce up to ±75% variance in distribution.
 *
 * Fix (v1): Acquire `pg_advisory_xact_lock` on hash(tenantId:loadbalanced:
 * departmentId) inside a transaction before running the SELECT.  This
 * serialises the AGENT SELECTION so concurrent calls read sequentially-
 * committed open-lead counts.
 *
 * Fix (v2): the lock is now held through the Lead.assignedTo write. v1 held
 * it only for the SELECT; the orchestrator wrote Lead.assignedTo after the
 * transaction had committed and released the lock. A concurrent call could
 * run its SELECT in that window, read the just-chosen agent's stale open-lead
 * count, and pick the same agent again. Under a burst (and more so on a busy
 * CI runner) those repeats compounded into one agent getting 30+ of 100 leads.
 *
 * When the payload carries a leadId, the strategy now claims the lead
 * (UPDATE leads SET assigned_to = winner) inside the same locked transaction,
 * so the next caller's SELECT always sees it. The orchestrator's later write
 * of the same assignee is an idempotent no-op. Selection + claim is therefore
 * atomic per (tenant, department), and a burst distributes evenly.
 *
 * ── Conventional closed stage slugs ──────────────────────────────────────────
 *
 * Conventional closed stage slugs in this codebase: won, lost, cancelled, closed.
 * Add more as the product grows; this list lives here so it's a single place
 * to update.
 *
 * ── Raw SQL note ─────────────────────────────────────────────────────────────
 *
 * Raw SQL is used for the aggregate query because Prisma ORM does not support
 * LEFT JOIN + COUNT natively. Parameterised via Prisma.sql — NO $queryRawUnsafe.
 *
 * MAINTENANCE NOTE: this raw SQL references mapped database column names
 * directly (u.is_active, u.on_leave_until, u.department_id, u.tenant_id,
 * l.assigned_to, l.stage_id, l.updated_at, ps.slug, ps.tenant_id). If any
 * of those columns is renamed in a future migration, this query must be
 * updated by hand — Prisma cannot type-check raw SQL.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { IntakePayload } from "../../types";

/** Stage slugs that indicate a closed/terminal lead state. */
const CLOSED_STAGE_SLUGS = ["won", "lost", "cancelled", "closed"];

// ── Advisory-lock key derivation ──────────────────────────────────────────────

/**
 * Derives a positive bigint advisory-lock key for a (tenant, departmentId)
 * load-balanced selection.
 *
 * Uses the same polynomial-hash approach as the round-robin cursor and the
 * dedup per-phone lock.  The "loadbalanced:" prefix prevents collisions with
 * other advisory-lock namespaces.
 */
function loadBalancedLockKey(tenantId: string, departmentId: string | undefined): bigint {
  const PRIME = BigInt(131);
  const MASK = (BigInt(1) << BigInt(63)) - BigInt(1);
  const scope = `${tenantId}:loadbalanced:${departmentId ?? "none"}`;
  let h = BigInt(0);
  for (const ch of scope) {
    h = (h * PRIME + BigInt(ch.charCodeAt(0))) & MASK;
  }
  return h;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadBalanced(payload: IntakePayload): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    // Acquire a transaction-scoped advisory lock per (tenant, department).
    // Serialises select-and-claim so each caller sees every earlier claim.
    const key = loadBalancedLockKey(payload.tenantId, payload.departmentId);
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${key}::bigint)`,
    );

    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
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

    const winner = rows[0]?.id ?? null;

    // Claim the lead while still holding the lock, so the next caller's
    // SELECT counts it against this agent. tenantId in the WHERE keeps a
    // crafted cross-tenant leadId from being touched (P2025 instead).
    if (winner && payload.leadId) {
      await tx.lead.update({
        where: { id: payload.leadId, tenantId: payload.tenantId },
        data: { assignedTo: winner },
      });
    }

    return winner;
  });
}
