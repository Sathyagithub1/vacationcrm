/**
 * src/app/api/payments/route.ts
 *
 * Phase 6c — Payment create and list endpoints.
 *
 * POST /api/payments
 *   Creates a Razorpay order and a Payment row (status=CREATED).
 *   Returns { paymentId, razorpayOrderId, amount, currency, razorpayKeyId }
 *   so the client can launch Razorpay Checkout.
 *
 * GET /api/payments
 *   Lists payments for the authenticated tenant with optional filters:
 *   status, customerId, leadId, dateFrom, dateTo, page, limit
 *
 * Auth: requireAuth() for GET; requirePermission("leads:create") for POST
 * Tenant scoping: all DB writes go through tenantPrisma (auto-injects tenantId)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { createOrder } from "@/lib/razorpay";
import { prisma } from "@/lib/prisma";

// ── POST /api/payments ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("leads:create");

    const body = (await request.json()) as Record<string, unknown>;

    const customerId = typeof body.customerId === "string" ? body.customerId : null;
    const leadId = typeof body.leadId === "string" ? body.leadId : null;
    const tourId = typeof body.tourId === "string" ? body.tourId : null;
    const seats = typeof body.seats === "number" ? Math.max(1, body.seats) : 1;
    const amountPaise = typeof body.amountPaise === "number" ? body.amountPaise : null;
    const notes = body.notes && typeof body.notes === "object" ? body.notes : undefined;

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }
    if (amountPaise === null || amountPaise <= 0) {
      return NextResponse.json(
        { error: "amountPaise must be a positive integer (amount in INR paise)" },
        { status: 400 },
      );
    }

    // Verify customer belongs to this tenant
    const customer = await db.customer.findFirst({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Build receipt (visible in Razorpay dashboard)
    const receipt = `crm-${user.tenantId.slice(0, 8)}-${Date.now()}`;

    // Build notes for Razorpay order (helps correlate in Razorpay dashboard)
    const rzpNotes: Record<string, string> = {
      tenantId: user.tenantId,
      customerId,
      ...(leadId ? { leadId } : {}),
      ...(tourId ? { tourId } : {}),
      seats: String(seats),
    };

    // 1. Create Razorpay order — throws if credentials not configured (412)
    let orderResult: Awaited<ReturnType<typeof createOrder>>;
    try {
      orderResult = await createOrder(user.tenantId, {
        amountPaise,
        currency: "INR",
        receipt,
        notes: rzpNotes,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("credentials not configured")) {
        return NextResponse.json(
          { error: "Razorpay credentials not configured for this tenant" },
          { status: 412 },
        );
      }
      console.error("createOrder error:", msg);
      return NextResponse.json({ error: "Failed to create Razorpay order" }, { status: 502 });
    }

    // 2. Persist Payment row — tenantId auto-injected by tenantPrisma
    const payment = await (db.payment.create as Function)({
      data: {
        tenantId: user.tenantId,
        customerId,
        leadId: leadId ?? null,
        tourId: tourId ?? null,
        seats,
        amountPaise,
        currency: "INR",
        razorpayOrderId: orderResult.orderId,
        status: "CREATED",
        notes: notes ?? rzpNotes,
      },
    });

    // 3. Fetch razorpayKeyId (public) + display name for the Checkout window
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { razorpayKeyId: true, name: true, productName: true },
    });

    return NextResponse.json(
      {
        paymentId: payment.id,
        razorpayOrderId: orderResult.orderId,
        amount: orderResult.amount,
        currency: orderResult.currency,
        razorpayKeyId: tenant?.razorpayKeyId ?? null,
        merchantName: tenant?.productName || tenant?.name || "Payment",
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/payments error:", err);
    return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
  }
}

// ── GET /api/payments ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const customerId = searchParams.get("customerId") ?? undefined;
    const leadId = searchParams.get("leadId") ?? undefined;
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (leadId) where.leadId = leadId;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [payments, total] = await Promise.all([
      (db.payment.findMany as Function)({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, mobile: true } },
          lead: { select: { id: true, destination: true } },
          tour: { select: { id: true, code: true, name: true } },
          booking: { select: { id: true, status: true } },
        },
      }),
      (db.payment.count as Function)({ where }),
    ]);

    return NextResponse.json({
      payments,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    console.error("GET /api/payments error:", err);
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}
