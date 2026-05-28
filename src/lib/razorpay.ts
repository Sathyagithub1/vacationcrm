/**
 * src/lib/razorpay.ts
 *
 * Razorpay SDK client wrapper (Phase 6f).
 *
 * Uses the official `razorpay` npm SDK (v2.x) instead of the hand-written
 * REST client from Phase 6c.  The SDK handles authentication, JSON serialisation,
 * and error parsing — we add tenant credential resolution on top.
 *
 * API base: https://api.razorpay.com/v1
 * Auth: HTTP Basic (key_id : key_secret) — handled by the SDK
 * Webhook signature: HMAC-SHA256 of raw body with webhook_secret
 *
 * Credentials are per-tenant from the DB; never from environment variables.
 * Never log razorpayKeyId or razorpayKeySecret.
 *
 * Webhook signature verification:
 *   Razorpay.validateWebhookSignature(body, signature, secret) is used.
 *   We still wrap with a try/catch and explicit false return to ensure
 *   consistent behaviour when the SDK throws (e.g. malformed input).
 */

import Razorpay from "razorpay";
import { prisma } from "@/lib/prisma";
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RazorpayOrderParams {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

export interface RazorpayRefundResult {
  refundId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
}

// SDK response shapes (what the Razorpay SDK actually returns)
interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
  [key: string]: unknown;
}

interface RazorpayRefundResponse {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  [key: string]: unknown;
}

// ── Tenant credential resolution ──────────────────────────────────────────────

interface TenantCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

/**
 * Look up Razorpay credentials for a tenant from the DB.
 * Throws if credentials are not configured — callers should surface this as a
 * 412 Precondition Failed.
 *
 * Cross-tenant isolation guarantee: credentials are always fetched by tenantId
 * and never shared across tenants. Keys are never logged.
 */
export async function getTenantCredentials(tenantId: string): Promise<TenantCredentials> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      razorpayKeyId: true,
      razorpayKeySecret: true,
      razorpayWebhookSecret: true,
    },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }
  if (!tenant.razorpayKeyId || !tenant.razorpayKeySecret) {
    throw new Error(`Razorpay credentials not configured for tenant ${tenantId}`);
  }

  // Decrypt secrets at read time.  `decryptIfEncrypted` is a no-op for
  // plaintext values — safe to call during the transition period before the
  // one-shot encrypt-tenant-credentials.ts script has run on production.
  // NEVER log the decrypted values.
  const keySecret = decryptIfEncrypted(tenant.razorpayKeySecret);
  const webhookSecret = tenant.razorpayWebhookSecret
    ? decryptIfEncrypted(tenant.razorpayWebhookSecret)
    : null;

  return {
    keyId: tenant.razorpayKeyId,
    keySecret,
    webhookSecret,
  };
}

/**
 * Build a Razorpay SDK client for the given tenant.
 * Returns both the client and the raw credentials (for webhookSecret access).
 */
async function buildClient(
  tenantId: string,
): Promise<{ client: Razorpay; creds: TenantCredentials }> {
  const creds = await getTenantCredentials(tenantId);
  const client = new Razorpay({
    key_id: creds.keyId,
    key_secret: creds.keySecret,
  });
  return { client, creds };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a Razorpay order for the given tenant.
 * Amount must be in paise (INR × 100).
 *
 * Returns the Razorpay order ID, amount, and currency so the frontend can
 * launch Razorpay Checkout.
 */
export async function createOrder(
  tenantId: string,
  params: RazorpayOrderParams,
): Promise<RazorpayOrderResult> {
  const { client } = await buildClient(tenantId);

  const res = (await client.orders.create({
    amount: params.amountPaise,
    currency: params.currency ?? "INR",
    receipt: params.receipt,
    notes: params.notes ?? {},
  })) as unknown as RazorpayOrderResponse;

  return {
    orderId: res.id,
    amount: res.amount,
    currency: res.currency,
    receipt: res.receipt,
    status: res.status,
  };
}

/**
 * Issue a full or partial refund for a captured payment.
 *
 * @param tenantId     - Tenant performing the refund (used to load credentials)
 * @param paymentId    - Razorpay payment ID (pay_xxxxx)
 * @param amountPaise  - Amount to refund in paise; omit for full refund
 */
export async function refundPayment(
  tenantId: string,
  paymentId: string,
  amountPaise?: number,
): Promise<RazorpayRefundResult> {
  const { client } = await buildClient(tenantId);

  const body: { amount?: number } = {};
  if (amountPaise !== undefined) body.amount = amountPaise;

  const res = (await client.payments.refund(paymentId, body)) as unknown as RazorpayRefundResponse;

  return {
    refundId: res.id,
    paymentId: res.payment_id,
    amount: res.amount,
    currency: res.currency,
    status: res.status,
  };
}

/**
 * Verify a Razorpay webhook signature.
 *
 * Uses `Razorpay.validateWebhookSignature(body, signature, secret)` from the
 * official SDK. The SDK performs constant-time comparison internally.
 * We wrap with try/catch so that malformed input returns false rather than
 * throwing, preserving the same calling convention as the previous implementation.
 *
 * @returns true  if the signature is valid
 * @returns false if the signature is invalid or an error occurs
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): boolean {
  if (!rawBody || !signature || !webhookSecret) return false;

  try {
    return Razorpay.validateWebhookSignature(rawBody, signature, webhookSecret);
  } catch {
    return false;
  }
}
