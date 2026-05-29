/**
 * src/app/api/payments/[id]/refund/route.ts
 *
 * Phase 6c — Admin/agent triggers a Razorpay refund for a payment.
 *
 * POST /api/payments/:id/refund
 *   Body: { amountPaise?: number }  (omit for full refund)
 *
 *   1. Validates the Payment exists, is CAPTURED, and belongs to the tenant.
 *   2. Calls Razorpay refund API (may be partial if amountPaise provided).
 *   3. Sets Payment.status = REFUND_PENDING.
 *   4. The Razorpay webhook (refund.processed) will later flip to REFUNDED
 *      and cancel the TourBooking if one exists.
 *
 * Auth: requires "settings:integrations" permission (admin/dept-manager only)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { refundPayment } from "@/lib/razorpay";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user, db } = await requirePermission("settings:integrations");
    const { id } = await context.params;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawAmountPaise =
      typeof body.amountPaise === "number" && body.amountPaise > 0
        ? body.amountPaise
        : undefined;

    // 1. Load payment — tenant-scoped via tenantPrisma
    const payment = await (db.payment.findFirst as Function)({
      where: { id },
      select: {
        id: true,
        status: true,
        razorpayPaymentId: true,
        amountPaise: true,
        tenantId: true,
      },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status !== "CAPTURED") {
      return NextResponse.json(
        {
          error: `Cannot refund a payment in status ${payment.status}. Only CAPTURED payments can be refunded.`,
        },
        { status: 422 },
      );
    }

    if (!payment.razorpayPaymentId) {
      return NextResponse.json(
        { error: "Payment has no razorpayPaymentId — cannot refund" },
        { status: 422 },
      );
    }

    // Phase 6i — clamp the partial-refund amount so a caller can never request
    // more than the captured amount. Razorpay would reject it, but only after
    // a network round-trip — better to fail fast on our side. Full refund is
    // the default when amountPaise is omitted.
    const amountPaise =
      rawAmountPaise === undefined
        ? undefined
        : Math.min(rawAmountPaise, payment.amountPaise);
    if (rawAmountPaise !== undefined && rawAmountPaise > payment.amountPaise) {
      return NextResponse.json(
        {
          error: `Refund amount ${rawAmountPaise} paise exceeds captured amount ${payment.amountPaise} paise.`,
        },
        { status: 422 },
      );
    }

    // Phase 6i — claim exclusivity BEFORE the external call. Atomic
    // status-conditional update: any concurrent refund attempt that races us
    // here will affect zero rows and we'll catch the P2025 to return 409.
    // This eliminates the double-refund window between findFirst and update.
    try {
      await (db.payment.update as Function)({
        where: { id: payment.id, status: "CAPTURED" },
        data: { status: "REFUND_PENDING" },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "P2025") {
        return NextResponse.json(
          {
            error:
              "Refund already in flight for this payment. Status changed concurrently — refresh and retry if appropriate.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    // 2. Call Razorpay refund API. If this throws, roll the status back so
    //    the user can retry rather than being stuck in REFUND_PENDING forever.
    let refundResult: Awaited<ReturnType<typeof refundPayment>>;
    try {
      refundResult = await refundPayment(user.tenantId, payment.razorpayPaymentId, amountPaise);
    } catch (err: unknown) {
      // Roll back: only flip CAPTURED if we still hold REFUND_PENDING
      await (db.payment.update as Function)({
        where: { id: payment.id, status: "REFUND_PENDING" },
        data: { status: "CAPTURED" },
      }).catch(() => {});

      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("credentials not configured")) {
        return NextResponse.json(
          { error: "Razorpay credentials not configured for this tenant" },
          { status: 412 },
        );
      }
      console.error("Razorpay refund error:", msg);
      return NextResponse.json({ error: "Failed to initiate refund with Razorpay" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      refundId: refundResult.refundId,
      status: "REFUND_PENDING",
      message: "Refund initiated. Status will update to REFUNDED once confirmed by Razorpay webhook.",
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/payments/:id/refund error:", err);
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
}
