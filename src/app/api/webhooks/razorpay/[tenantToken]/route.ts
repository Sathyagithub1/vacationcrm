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
import { decryptIfEncrypted } from "@/lib/crypto/credential-encryption";
import { sendEmail } from "@/modules/notifications/channels/email.channel";
import { sendSms } from "@/modules/notifications/channels/sms.channel";
import { sendWhatsApp } from "@/modules/notifications/channels/whatsapp.channel";

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
  // Phase 6g stores razorpayWebhookSecret encrypted (v1:...) at rest — must
  // decrypt before HMAC verification. Without this, every legitimate webhook
  // fails signature check because HMAC runs against the ciphertext blob.
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const webhookSecret = decryptIfEncrypted(tenant.razorpayWebhookSecret);

  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
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
 *  5. Send Email + SMS + WhatsApp confirmation to customer (Phase 6h)
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
      amountPaise: true,
      currency: true,
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

  // 5. Send confirmation across all 3 channels (fire-and-forget — each is
  //    fail-soft and won't block the webhook 200). Phase 6h.
  void sendPaymentConfirmation({
    tenantId,
    customerId: payment.customerId,
    tourId: payment.tourId,
    seats: payment.seats,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    razorpayPaymentId,
  }).catch((err) => {
    console.warn(
      `[Razorpay webhook] confirmation send failed for payment ${payment.id}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

/**
 * Send payment confirmation to the customer via email + SMS + WhatsApp.
 *
 * Each channel is fail-soft — if SMTP / SMS / WhatsApp isn't configured the
 * underlying channel returns false and we keep going. Customer might receive
 * 1, 2, or 3 receipts depending on what's wired up.
 *
 * Channel selection by what the customer has:
 *   - Email → if customer.email
 *   - SMS / WhatsApp → if customer.mobile
 *
 * NEVER throw from this function — it runs in fire-and-forget context.
 */
interface PaymentConfirmationArgs {
  tenantId: string;
  customerId: string;
  tourId: string | null;
  seats: number;
  amountPaise: number;
  currency: string;
  razorpayPaymentId: string;
}

async function sendPaymentConfirmation(args: PaymentConfirmationArgs): Promise<void> {
  const [customer, tour, tenant] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: args.customerId },
      select: { name: true, email: true, mobile: true },
    }),
    args.tourId
      ? prisma.tour.findUnique({
          where: { id: args.tourId },
          select: { name: true, code: true, startDate: true, endDate: true, description: true },
        })
      : Promise.resolve(null),
    prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { name: true, productName: true },
    }),
  ]);

  if (!customer) return;

  const merchantName = tenant?.productName || tenant?.name || "Your travel agency";
  const amountFormatted = `${args.currency} ${(args.amountPaise / 100).toLocaleString("en-IN")}`;
  const tourLine = tour
    ? `${tour.name}${tour.code ? ` (${tour.code})` : ""}`
    : "Your booking";
  const datesLine = tour?.startDate
    ? `${new Date(tour.startDate).toDateString()}${tour.endDate ? ` to ${new Date(tour.endDate).toDateString()}` : ""}`
    : null;
  const seatsLine = args.seats > 1 ? `${args.seats} seats` : "1 seat";
  const refLine = `Payment ref: ${args.razorpayPaymentId}`;

  const summaryText = [
    `Hi ${customer.name},`,
    "",
    `Your payment of ${amountFormatted} has been received. Thank you!`,
    "",
    `Tour: ${tourLine}`,
    datesLine ? `Dates: ${datesLine}` : null,
    `Seats: ${seatsLine}`,
    refLine,
    "",
    `— ${merchantName}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  // Email
  if (customer.email) {
    void sendEmail({
      to: customer.email,
      subject: `Booking confirmed — ${tour?.name ?? "your tour"}`,
      body: summaryText,
    }).catch(() => {});
  }

  // SMS + WhatsApp — both use mobile
  if (customer.mobile) {
    const shortMessage = [
      `${merchantName}: Payment of ${amountFormatted} received.`,
      tour ? `Tour: ${tour.name}` : null,
      datesLine ? `Dates: ${datesLine}` : null,
      `Seats: ${seatsLine}.`,
      refLine,
    ]
      .filter((line): line is string => line !== null)
      .join(" ");

    void sendSms({ to: customer.mobile, message: shortMessage }).catch(() => {});
    void sendWhatsApp({ to: customer.mobile, message: summaryText }).catch(() => {});
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
