/**
 * src/app/api/payments/[id]/route.ts
 *
 * Phase 6c — Single payment detail + refund trigger.
 *
 * GET  /api/payments/:id     — fetch payment with related booking
 * POST /api/payments/:id/refund — admin/agent triggers a Razorpay refund;
 *   body: { amountPaise?: number }  (omit for full refund)
 *   sets status → REFUND_PENDING (webhook sets REFUNDED + cancels booking)
 *
 * Auth: requireAuth() for GET; requirePermission for refund
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { refundPayment } from "@/lib/razorpay";

type RouteContext = { params: Promise<{ id: string }> };

// ── GET /api/payments/:id ─────────────────────────────────────────────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { db } = await requireAuth();
    const { id } = await context.params;

    const payment = await (db.payment.findFirst as Function)({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, mobile: true, email: true } },
        lead: { select: { id: true, destination: true, travelDate: true } },
        tour: { select: { id: true, code: true, name: true, startDate: true } },
        booking: {
          select: {
            id: true,
            status: true,
            seats: true,
            bookedAt: true,
          },
        },
      },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    return NextResponse.json({ payment });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/payments/:id error:", err);
    return NextResponse.json({ error: "Failed to fetch payment" }, { status: 500 });
  }
}

// ── POST /api/payments/:id/refund ─────────────────────────────────────────────
// Note: Next.js App Router does not support dynamic sub-paths on the same file.
// /api/payments/[id]/refund lives in a separate route file.
// This POST handler is intentionally NOT here — see ./refund/route.ts.
