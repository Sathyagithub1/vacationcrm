// src/lib/prisma-middleware-tour-sold.ts

/**
 * Tour sold-count + status auto-flip middleware (Phase 6a, T21).
 *
 * When a `TourBooking` row is created, updated, or deleted, recomputes the
 * parent Tour's `sold` count (sum of `seats` for CONFIRMED bookings only) and
 * flips the Tour status:
 *
 *   ACTIVE  → SOLD_OUT  when sold >= capacity
 *   SOLD_OUT → ACTIVE   when sold < capacity  (reopens on cancellation)
 *
 * Only ACTIVE ↔ SOLD_OUT transitions are automated. DRAFT, CANCELLED and
 * COMPLETED tours are admin-managed and are never auto-flipped.
 *
 * Implementation:
 *   Prisma 6 removed `$use` (the middleware API). We use `$extends` with
 *   query-level hooks instead. `$extends` returns a new extended client — the
 *   caller is responsible for using the returned value. The base `PrismaClient`
 *   passed to `buildTourSoldExtension` is only used inside the hooks to run the
 *   recompute queries (to avoid touching the extended client in hooks, which
 *   could introduce reentrancy issues). In practice `prisma.ts` wraps the base
 *   client and the extension in a single IIFE so `tenantPrisma` composes on top.
 *
 * No recursion risk: hooks fire on `TourBooking` writes only. The Tour.update
 * inside `recomputeTour` does NOT re-trigger these hooks because the model check
 * is `TourBooking`, not `Tour`.
 */

import { Prisma, PrismaClient } from "@prisma/client";

async function recomputeTour(base: PrismaClient, tourId: string): Promise<void> {
  const tour = await base.tour.findUnique({
    where: { id: tourId },
    select: { id: true, sold: true, capacity: true, status: true },
  });
  if (!tour) return;

  // Only auto-flip ACTIVE <-> SOLD_OUT; leave DRAFT/CANCELLED/COMPLETED alone
  if (tour.status !== "ACTIVE" && tour.status !== "SOLD_OUT") return;

  const agg = await base.tourBooking.aggregate({
    where: { tourId, status: "CONFIRMED" },
    _sum: { seats: true },
  });
  const newSold = agg._sum.seats ?? 0;

  let newStatus: "ACTIVE" | "SOLD_OUT" = tour.status;
  if (newSold >= tour.capacity && tour.status === "ACTIVE") newStatus = "SOLD_OUT";
  else if (newSold < tour.capacity && tour.status === "SOLD_OUT") newStatus = "ACTIVE";

  if (newSold !== tour.sold || newStatus !== tour.status) {
    await base.tour.update({
      where: { id: tourId },
      data: { sold: newSold, status: newStatus },
    });
  }
}

/**
 * Build a Prisma `$extends` extension that recomputes Tour.sold and auto-flips
 * Tour.status after every TourBooking write.
 *
 * @param base - the raw (non-extended) PrismaClient used to issue the
 *   recompute queries. Must be the same underlying DB connection.
 */
export function buildTourSoldExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "tour-sold-middleware",
    query: {
      tourBooking: {
        async create({ args, query }) {
          const result = await query(args);
          const tourId = (result as { tourId?: string }).tourId;
          if (tourId) await recomputeTour(base, tourId);
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          const tourId = (result as { tourId?: string }).tourId;
          if (tourId) {
            await recomputeTour(base, tourId);
          } else if (typeof args.where?.id === "string") {
            // If tourId not in result, look it up from the updated row
            const booking = await base.tourBooking.findUnique({
              where: { id: args.where.id as string },
              select: { tourId: true },
            });
            if (booking) await recomputeTour(base, booking.tourId);
          }
          return result;
        },
        async delete({ args, query }) {
          // Capture tourId before deletion since result is the deleted row
          const result = await query(args);
          const tourId = (result as { tourId?: string }).tourId;
          if (tourId) await recomputeTour(base, tourId);
          return result;
        },
        async createMany({ args, query }) {
          const result = await query(args);
          const data = Array.isArray(args.data) ? args.data : [args.data];
          const tourIds = [
            ...new Set(
              data
                .map((d: Record<string, unknown>) => d.tourId)
                .filter((id): id is string => typeof id === "string")
            ),
          ];
          for (const tourId of tourIds) await recomputeTour(base, tourId);
          return result;
        },
        async updateMany({ args, query }) {
          const result = await query(args);
          // Best-effort: extract tourId from where clause
          const where = args.where as Record<string, unknown> | undefined;
          const tourIds = extractTourIdsFromWhere(where);
          for (const tourId of tourIds) await recomputeTour(base, tourId);
          return result;
        },
        async deleteMany({ args, query }) {
          const result = await query(args);
          const where = args.where as Record<string, unknown> | undefined;
          const tourIds = extractTourIdsFromWhere(where);
          for (const tourId of tourIds) await recomputeTour(base, tourId);
          return result;
        },
      },
    },
  });
}

function extractTourIdsFromWhere(
  where: Record<string, unknown> | undefined
): string[] {
  if (!where) return [];
  if (typeof where.tourId === "string") return [where.tourId];
  if (
    where.tourId &&
    typeof where.tourId === "object" &&
    "in" in (where.tourId as Record<string, unknown>)
  ) {
    const inList = (where.tourId as { in: unknown[] }).in;
    return inList.filter((id): id is string => typeof id === "string");
  }
  return [];
}

/**
 * Attach the tour-sold auto-flip middleware to a PrismaClient instance.
 *
 * Returns the extended client — callers MUST use the returned value.
 * The `base` client is kept for recompute queries inside the hooks.
 */
export function attachTourSoldMiddleware(base: PrismaClient) {
  return base.$extends(buildTourSoldExtension(base));
}
