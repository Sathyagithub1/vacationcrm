/**
 * src/lib/tenant-limits.test.ts — Per-tenant quota helper tests.
 *
 * Verifies the DEFAULT-OFF guarantee: with no plan (the state of the live
 * tenant) checkQuota is a no-op that always allows; caps apply only when an
 * explicit, known plan is set.
 */

import { describe, it, expect } from "vitest";
import { checkQuota, getPlanLimit } from "./tenant-limits";

describe("lib/tenant-limits", () => {
  it("no plan => unlimited (allowed, limit null)", () => {
    const r = checkQuota(null, "users", 9999, 1);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBeNull();
  });

  it("unknown plan => unlimited", () => {
    expect(getPlanLimit("mystery-tier", "leads")).toBeNull();
    expect(checkQuota("mystery-tier", "leads", 1_000_000).allowed).toBe(true);
  });

  it("known plan enforces its cap", () => {
    expect(getPlanLimit("free", "users")).toBe(3);
    expect(checkQuota("free", "users", 2, 1).allowed).toBe(true); // 3 <= 3
    expect(checkQuota("free", "users", 3, 1).allowed).toBe(false); // 4 > 3
  });

  it("uncapped resource on a known plan => unlimited", () => {
    // enterprise is intentionally absent from PLAN_LIMITS => unlimited
    expect(getPlanLimit("enterprise", "users")).toBeNull();
    expect(checkQuota("enterprise", "users", 10_000).allowed).toBe(true);
  });
});
