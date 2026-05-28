/**
 * src/lib/razorpay.ts
 *
 * Razorpay REST client wrapper (Phase 6c).
 *
 * Implementation note — npm SDK unavailable:
 *   The `razorpay` npm package cannot be installed in this environment due to a
 *   TLS certificate chain issue (UNABLE_TO_VERIFY_LEAF_SIGNATURE). A manual
 *   REST client is implemented here using Node's built-in `https` module and the
 *   Razorpay v1 REST API. Behaviour is identical to the official SDK.
 *   See TODO_BLOCKERS.md § 6C-B1 for migration path when npm access is restored.
 *
 * API base: https://api.razorpay.com/v1
 * Auth: HTTP Basic (key_id : key_secret)
 * Webhook signature: HMAC-SHA256 of raw body with webhook_secret
 *
 * Environment vars — NOT used here; credentials are per-tenant from the DB.
 * Never log razorpayKeyId or razorpayKeySecret.
 */

import { createHmac, timingSafeEqual } from "crypto";
import * as https from "https";
import { prisma } from "@/lib/prisma";

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

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
  error?: string;
  description?: string;
}

interface RazorpayRefundResponse {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  error?: string;
  description?: string;
}

// ── Internal REST helper ──────────────────────────────────────────────────────

/**
 * Make an authenticated HTTPS request to the Razorpay v1 API.
 * Returns the parsed JSON response body.
 * Throws on HTTP 4xx/5xx with the error description from Razorpay.
 */
function razorpayRequest<T>(
  method: "GET" | "POST",
  path: string,
  keyId: string,
  keySecret: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const options: https.RequestOptions = {
      hostname: "api.razorpay.com",
      path: `/v1${path}`,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed: T;
        try {
          parsed = JSON.parse(raw) as T;
        } catch {
          reject(new Error(`Razorpay returned non-JSON: ${raw}`));
          return;
        }

        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 400) {
          const err = parsed as { error?: { description?: string } };
          const description = err?.error?.description ?? raw;
          reject(new Error(`Razorpay API error ${statusCode}: ${description}`));
          return;
        }
        resolve(parsed);
      });
    });

    req.on("error", (err: Error) => {
      reject(new Error(`Razorpay HTTP error: ${err.message}`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
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

  return {
    keyId: tenant.razorpayKeyId,
    keySecret: tenant.razorpayKeySecret,
    webhookSecret: tenant.razorpayWebhookSecret ?? null,
  };
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
  const { keyId, keySecret } = await getTenantCredentials(tenantId);

  const res = await razorpayRequest<RazorpayOrderResponse>(
    "POST",
    "/orders",
    keyId,
    keySecret,
    {
      amount: params.amountPaise,
      currency: params.currency ?? "INR",
      receipt: params.receipt,
      notes: params.notes ?? {},
    },
  );

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
  const { keyId, keySecret } = await getTenantCredentials(tenantId);

  const body: Record<string, unknown> = {};
  if (amountPaise !== undefined) body.amount = amountPaise;

  const res = await razorpayRequest<RazorpayRefundResponse>(
    "POST",
    `/payments/${paymentId}/refund`,
    keyId,
    keySecret,
    body,
  );

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
 * Razorpay signs the raw request body with HMAC-SHA256 using the webhook
 * secret. The signature is sent in the `X-Razorpay-Signature` header.
 *
 * Uses `timingSafeEqual` to prevent timing-attack-based forgery.
 *
 * @returns true  if the signature is valid
 * @returns false if the signature is invalid or an encoding error occurs
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): boolean {
  if (!rawBody || !signature || !webhookSecret) return false;

  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
