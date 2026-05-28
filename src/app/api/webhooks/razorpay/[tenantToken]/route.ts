/**
 * src/app/api/webhooks/razorpay/[tenantToken]/route.ts
 *
 * Phase 6c — Razorpay webhook handler (tenant-scoped).
 *
 * URL: POST /api/webhooks/razorpay/:tenantToken
 *
 * Authentication model:
 *   Tenant is resolved by the intakeToken in the URL path (same pattern as
 *   Google Forms and intake webhooks). This means each tenant configures
 *   a unique webhook URL in their Razorpay dashboard — no shared secret
 *   collisions between tenants.
 *
 *   Signature verification:
 *     Header: X-Razorpay-Signature: <hex>
 *     HMAC-SHA256(rawBody, tenant.razorpayWebhookSecret)
 *
 * Events handled:
 *   payment.captured  → Payment CAPTURED + TourBooking CONFIRMED
 *   payment.failed    → Payment FAILED + errorMessage
 *   refund.created    → Payment REFUND_PENDING (already set by API; no-op or confirm)
 *   refund.processed  → Payment REFUNDED + TourBooking CANCELLED
 *
 * Error handling:
 *   Unknown tenantToken      → 401
 *   Webhook secret missing   → 412
 *   Bad signature            → 401
 *   Unknown event            → 200 (ignore; don't break Razorpay retry)
 *   DB error                 → 500
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";

type RouteContext = { params: Promise<{ tenantToken: string }> };

// ── Razorpay webhook payload shapes (minimal, only fields we use) ─────────────

interface RzpPaymentCapturedPayload {
  payment: {
    entity: {
      id: string;                 // pay_xxx
      order_id: string;           // order_xxx
      amount: number;             // paise
      status: string;
    };
  };
}

interface RzpPaymentFailedPayload {
  payment: {
    entity: {
      id: string;
      order_id: string;
      error_description?: string;
      error_code?: string;
    };
  };
}

interface RzpRefundPayload {
  refund: {
    entity: {
      id: string;
      payment_id: string;
      amount: number;
      status: string;
    };
  };
}

interface RazorpayWebhookEvent {
  event: string;
  payload: RzpPaymentCapturedPayload & RzpPaymentFailedPayload & RzpRefundPayload;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, context: RouteContext) {
  const { tenantToken } = await context.params;

  // ── 1. Resolve tenant by intakeToken ──────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({
    where: { intakeToken: tenantToken },
    select: {
      id: true,
      razorpayWebhookSecret: true,
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Invalid tenant token" }, { status: 401 });
  }

  // ── 2. Require webhook secret to be configured ────────────────────────────
  if (!tenant.razorpayWebhookSecret) {
    return NextResponse.json(
      { error: "Razorpay webhook secret not configured for this tenant" },
      { status: 412 },
    );
  }

  // ── 3. Read raw body (must come before JSON parse) ────────────────────────
  const rawBody = await req.text();

  // ── 4. Verify X-Razorpay-Signature ───────────────────────────────────────
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(rawBody, signature, tenant.razorpayWebhookSecret)) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // ── 5. Parse event ────────────────────────────────────────────────────────
  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── 6. Route by event type ────────────────────────────────────────────────
  try {
    switch (event.event) {
      case "payment.captured":
        await handlePaymentCaptured(tenant.id, event.payload);
        break;

      case "payment.failed":
        await handlePaymentFailed(tenant.id, event.payload);
        break;

      case "refund.created":
        // Already set to REFUND_PENDING by the refund API; no-op to avoid race.
        break;

      case "refund.processed":
        await handleRefundProcessed(tenant.id, event.payload);
        break;

      default:
        // Unknown events are acknowledged (200) but not processed.
        break;
    }
  } catch (err: unknown) {
    console.error(`Razorpay webhook [${event.event}] error for tenant ${tenant.id}:`, err);
    return NextResponse.json(
      { error: "Webhook processing error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

// ── Event handlers ────────────────────────────────────────────────────────────

/**
 * payment.captured
 *  1. Look up Payment by razorpayOrderId
 *  2. Update status → CAPTURED, set paidAt + razorpayPaymentId
 *  3. If tourId + seats present, create TourBooking (triggers tour sold middleware)
 *  4. Link booking back to Payment
 */
async function handlePaymentCaptured(
  tenantId: string,
  payload: RzpPaymentCapturedPayload,
): Promise<void> {
  const entity = payload.payment?.entity;
  if (!entity) return;

  const { id: razorpayPaymentId, order_id: razorpayOrderId } = entity;

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId },
    select: {
      id: true,
      tenantId: true,
      tourId: true,
      seats: true,
      customerId: true,
      leadId: true,
      status: true,
    },
  });

  // Guard: only process if payment belongs to this tenant + is in CREATED/AUTHORIZED
  if (!payment || payment.tenantId !== tenantId) return;
  if (payment.status === "CAPTURED") return; // idempotent

  // Update payment
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "CAPTURED",
      razorpayPaymentId,
      paidAt: new Date(),
    },
    select: { id: true, tourId: true, seats: true, customerId: true, leadId: true, bookingId: true },
  });

  // Create TourBooking if tour + seats specified and not already booked
  if (updatedPayment.tourId && !updatedPayment.bookingId) {
    const booking = await prisma.tourBooking.create({
      data: {
        tourId: updatedPayment.tourId,
        customerId: updatedPayment.customerId,
        leadId: updatedPayment.leadId ?? null,
        seats: updatedPayment.seats,
        status: "CONFIRMED",
      },
      select: { id: true },
    });

    // Link booking back to payment
    await prisma.payment.update({
      where: { id: updatedPayment.id },
      data: { bookingId: booking.id },
    });
  }
}

/**
 * payment.failed
 *  1. Look up Payment by razorpayOrderId
 *  2. Update status → FAILED + errorMessage
 */
async function handlePaymentFailed(
  tenantId: string,
  payload: RzpPaymentFailedPayload,
): Promise<void> {
  const entity = payload.payment?.entity;
  if (!entity) return;

  const { order_id: razorpayOrderId, error_description, error_code } = entity;

  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId },
    select: { id: true, tenantId: true, status: true },
  });

  if (!payment || payment.tenantId !== tenantId) return;
  if (payment.status === "FAILED") return; // idempotent

  const errorMessage = [error_code, error_description].filter(Boolean).join(": ");

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
      errorMessage: errorMessage || "Payment failed",
    },
  });
}

/**
 * refund.processed
 *  1. Look up Payment by razorpayPaymentId
 *  2. Update status → REFUNDED, set refundedAt
 *  3. Cancel the linked TourBooking if it exists
 *     (triggers tour sold middleware → recomputes Tour.sold/status)
 */
async function handleRefundProcessed(
  tenantId: string,
  payload: RzpRefundPayload,
): Promise<void> {
  const entity = payload.refund?.entity;
  if (!entity) return;

  const { payment_id: razorpayPaymentId } = entity;

  const payment = await prisma.payment.findUnique({
    where: { razorpayPaymentId },
    select: {
      id: true,
      tenantId: true,
      bookingId: true,
      status: true,
    },
  });

  if (!payment || payment.tenantId !== tenantId) return;
  if (payment.status === "REFUNDED") return; // idempotent

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
    },
  });

  // Cancel booking — this triggers the tour sold middleware to decrement sold count
  if (payment.bookingId) {
    await prisma.tourBooking.update({
      where: { id: payment.bookingId },
      data: { status: "CANCELLED" },
    });
  }
}
