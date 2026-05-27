/**
 * src/app/api/tours/[id]/bookings/route.ts
 *
 * T39 — Tour bookings list + create.
 *
 * GET  /api/tours/:id/bookings  — list bookings for tour
 * POST /api/tours/:id/bookings  — create booking; triggers sold-count middleware
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id: tourId } = await context.params;
    const { user, db } = await requireAuth();
    if (user.role === "VIEWER") return forbidden();

    // Verify tour belongs to tenant
    const tour = await db.tour.findFirst({ where: { id: tourId } });
    if (!tour) return NextResponse.json({ error: "Tour not found" }, { status: 404 });

    // TourBooking has no tenantId — scope via tourId (which is tenant-owned)
    const bookings = await prisma.tourBooking.findMany({
      where: { tourId },
      orderBy: { bookedAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, mobile: true } },
        lead:     { select: { id: true } },
      },
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tourId } = await context.params;
    const { user, db } = await requirePermission("leads:create");

    // Verify tour belongs to tenant
    const tour = await db.tour.findFirst({ where: { id: tourId } });
    if (!tour) return NextResponse.json({ error: "Tour not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;

    const customerId = typeof body.customerId === "string" ? body.customerId : null;
    const leadId     = typeof body.leadId     === "string" ? body.leadId     : null;
    const seats      = typeof body.seats      === "number" ? body.seats      : 1;
    const status     = typeof body.status     === "string" ? body.status     : "CONFIRMED";

    if (!customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }

    if (seats < 1) {
      return NextResponse.json({ error: "seats must be at least 1" }, { status: 400 });
    }

    // Verify customer belongs to tenant
    const customer = await db.customer.findFirst({ where: { id: customerId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Use prisma (extended, with tour-sold middleware) for the create so
    // middleware fires automatically.
    const booking = await prisma.tourBooking.create({
      data: {
        tourId,
        customerId,
        leadId,
        seats,
        status: status as never,
      },
    });

    // Return updated tour to surface new sold/status
    const updatedTour = await db.tour.findFirst({ where: { id: tourId } });

    return NextResponse.json({ booking, tour: updatedTour }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    console.error("POST /api/tours/[id]/bookings error:", err);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
