/**
 * src/lib/tenant-limits.ts — Optional per-tenant quota helper (multi-tenant SaaS).
 *
 * DEFAULT-OFF GUARANTEE:
 *   Limits apply ONLY when a tenant has an explicit `plan` set AND that plan
 *   appears in PLAN_LIMITS with a numeric cap. When `plan` is null/unknown (the
 *   state of the existing live tenant, since the `plan` column defaults to
 *   NULL), checkQuota() always returns { allowed: true } — a complete no-op.
 *
 *   This helper is a small utility. It is safe to call anywhere; it never throws
 *   and never blocks unless a plan cap is explicitly configured and exceeded.
 */

export type QuotaResource = "users" | "leads" | "departments";

/**
 * Plan → resource caps. A missing resource key (or `null` value) means
 * "unlimited" for that resource. Add real plan definitions here as billing tiers
 * are introduced. Kept minimal on purpose.
 */
export const PLAN_LIMITS: Record<
  string,
  Partial<Record<QuotaResource, number>>
> = {
  free: { users: 3, leads: 100, departments: 1 },
  starter: { users: 10, leads: 2000, departments: 5 },
  pro: { users: 50, leads: 50000, departments: 25 },
  // enterprise intentionally omitted => unlimited on all resources
};

export interface QuotaCheck {
  allowed: boolean;
  /** null when unlimited / no plan set */
  limit: number | null;
  current: number;
  resource: QuotaResource;
}

/**
 * Look up the numeric cap for a resource under a plan.
 * Returns null (= unlimited) when no plan, unknown plan, or uncapped resource.
 */
export function getPlanLimit(
  plan: string | null | undefined,
  resource: QuotaResource,
): number | null {
  if (!plan) return null;
  const limits = PLAN_LIMITS[plan];
  if (!limits) return null;
  const cap = limits[resource];
  return typeof cap === "number" ? cap : null;
}

/**
 * Check whether adding `adding` more of `resource` stays within the plan cap.
 *
 * When no cap applies (no plan / unknown plan / uncapped resource) this is a
 * no-op that always returns allowed: true, limit: null.
 */
export function checkQuota(
  plan: string | null | undefined,
  resource: QuotaResource,
  current: number,
  adding = 1,
): QuotaCheck {
  const limit = getPlanLimit(plan, resource);
  if (limit === null) {
    return { allowed: true, limit: null, current, resource };
  }
  return {
    allowed: current + adding <= limit,
    limit,
    current,
    resource,
  };
}
