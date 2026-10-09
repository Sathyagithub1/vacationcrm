/**
 * src/lib/billing.ts — Multi-tenant SaaS billing scaffold (Stripe).
 *
 * DEFAULT-OFF GUARANTEE:
 *   Billing is DISABLED unless STRIPE_SECRET_KEY is set in the environment.
 *   When disabled (the default, and the state of the live single-tenant
 *   deployment), there is:
 *     - no enforcement,
 *     - no charges,
 *     - no Stripe SDK loaded,
 *   and every tenant is treated as active / free. Any subscription check that
 *   calls into this module MUST no-op when isBillingEnabled() is false.
 *
 * The Stripe SDK is intentionally NOT statically imported. It is loaded via a
 * lazy `require` ONLY inside createCheckoutSession, and only when a key is
 * present. This mirrors the codebase's optional-dependency pattern and keeps the
 * build working without the `stripe` package installed.
 */

/**
 * True iff Stripe is configured via STRIPE_SECRET_KEY. When false (default),
 * billing is a complete no-op — no enforcement, no charges, tenants are free.
 */
export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export interface CheckoutSessionParams {
  tenantId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

/**
 * Create a Stripe Checkout session for a tenant subscription.
 *
 * Throws a clear "billing not configured" error when Stripe keys are absent —
 * callers should first gate on isBillingEnabled() and treat billing as free
 * when it returns false. This function NEVER runs in the default deployment.
 */
export async function createCheckoutSession(
  params: CheckoutSessionParams,
): Promise<CheckoutSessionResult> {
  if (!isBillingEnabled()) {
    throw new Error(
      "billing not configured: set STRIPE_SECRET_KEY to enable checkout",
    );
  }

  // Lazy, optional require so the app builds/runs without the `stripe` package.
  let StripeCtor: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    StripeCtor = require("stripe");
  } catch {
    throw new Error(
      "billing not configured: the 'stripe' package is not installed",
    );
  }

  const Stripe = (StripeCtor as { default?: unknown }).default ?? StripeCtor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripe = new (Stripe as any)(process.env.STRIPE_SECRET_KEY as string);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
    client_reference_id: params.tenantId,
    metadata: { tenantId: params.tenantId },
  });

  return { id: session.id as string, url: (session.url as string) ?? null };
}

/**
 * Is a tenant allowed to operate? When billing is disabled (default), ALL
 * tenants are treated as active — this is a no-op that always returns true.
 * When billing is enabled, callers may pass the tenant's subscriptionStatus and
 * this returns false only for hard-stop states. Kept intentionally permissive
 * so enabling billing never breaks an existing tenant by surprise.
 */
export function isTenantActive(subscriptionStatus?: string | null): boolean {
  if (!isBillingEnabled()) return true; // default path: everyone is active/free
  if (!subscriptionStatus) return true;
  return subscriptionStatus !== "CANCELLED";
}
