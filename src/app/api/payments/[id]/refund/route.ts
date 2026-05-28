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
    const amountPaise =
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

    // 2. Call Razorpay refund API
    let refundResult: Awaited<ReturnType<typeof refundPayment>>;
    try {
      refundResult = await refundPayment(user.tenantId, payment.razorpayPaymentId, amountPaise);
    } catch (err: unknown) {
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

    // 3. Mark payment as REFUND_PENDING — webhook will complete the flow
    await (db.payment.update as Function)({
      where: { id: payment.id },
      data: { status: "REFUND_PENDING" },
    });

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
