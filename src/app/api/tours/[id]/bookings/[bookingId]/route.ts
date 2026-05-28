/**
 * src/app/api/tours/[id]/bookings/[bookingId]/route.ts
 *
 * T39 — Tour booking get / cancel.
 *
 * GET    /api/tours/:id/bookings/:bookingId
 * PATCH  /api/tours/:id/bookings/:bookingId  — cancel (status → CANCELLED)
 *                                              triggers sold-count recompute
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; bookingId: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id: tourId, bookingId } = await context.params;
    const { user, db } = await requireAuth();
    if (user.role === "VIEWER") return forbidden();

    // Verify tour belongs to tenant
    const tour = await db.tour.findFirst({ where: { id: tourId } });
    if (!tour) return NextResponse.json({ error: "Tour not found" }, { status: 404 });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: bookingId, tourId },
      include: {
        customer: { select: { id: true, name: true, mobile: true } },
        lead:     { select: { id: true } },
      },
    });

    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    return NextResponse.json({ booking });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch booking" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: tourId, bookingId } = await context.params;
    const { db } = await requirePermission("leads:edit");

    const tour = await db.tour.findFirst({ where: { id: tourId } });
    if (!tour) return NextResponse.json({ error: "Tour not found" }, { status: 404 });

    const booking = await prisma.tourBooking.findFirst({ where: { id: bookingId, tourId } });
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : null;

    const validStatuses = ["CONFIRMED", "CANCELLED", "WAITLISTED"];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    // Update via extended prisma (tour-sold middleware triggers on update)
    const updated = await prisma.tourBooking.update({
      where: { id: bookingId },
      data:  { status: status as never },
    });

    // Return updated tour so caller sees new sold/status
    const updatedTour = await db.tour.findFirst({ where: { id: tourId } });

    return NextResponse.json({ booking: updated, tour: updatedTour });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
    }
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}
