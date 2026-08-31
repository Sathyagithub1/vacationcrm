/**
 * src/lib/billing.test.ts — Multi-tenant SaaS billing scaffold tests.
 *
 * Verifies the DEFAULT-OFF guarantee: billing is disabled with no
 * STRIPE_SECRET_KEY, createCheckoutSession throws a clear error, and tenants
 * are treated as active/free when billing is off. No Stripe SDK, no DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBillingEnabled, createCheckoutSession, isTenantActive } from "./billing";

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

describe("lib/billing", () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  });

  it("isBillingEnabled() is false when STRIPE_SECRET_KEY is unset", () => {
    expect(isBillingEnabled()).toBe(false);
  });

  it("isBillingEnabled() is true when STRIPE_SECRET_KEY is set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isBillingEnabled()).toBe(true);
  });

  it("createCheckoutSession throws a clear 'billing not configured' error when disabled", async () => {
    await expect(
      createCheckoutSession({
        tenantId: "t1",
        priceId: "price_1",
        successUrl: "http://x/ok",
        cancelUrl: "http://x/cancel",
      }),
    ).rejects.toThrow(/billing not configured/i);
  });

  it("isTenantActive() always returns true when billing is disabled (free-for-all default)", () => {
    expect(isTenantActive(null)).toBe(true);
    expect(isTenantActive("CANCELLED")).toBe(true);
    expect(isTenantActive("SUSPENDED")).toBe(true);
  });

  it("isTenantActive() enforces CANCELLED only when billing is enabled", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isTenantActive("ACTIVE")).toBe(true);
    expect(isTenantActive(null)).toBe(true);
    expect(isTenantActive("CANCELLED")).toBe(false);
  });
});
