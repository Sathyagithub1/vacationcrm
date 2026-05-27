// src/lib/prisma-middleware-tour-sold.test.ts

/**
 * Integration tests for the Tour sold-count + auto-flip extension (T21).
 *
 * These tests use a real Prisma client with the tour-sold extension attached.
 * They seed their own Tenant → Department → Tour → Customer fixture data
 * and clean up in afterAll.
 *
 * The extension hooks fire on the `testClient` (extended client). Recompute
 * queries are issued via the `basePrisma` instance passed to
 * `attachTourSoldMiddleware`.
 *
 * Test isolation: each test uses a unique tenant ID to avoid cross-test
 * contamination.
 */

import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { attachTourSoldMiddleware } from "./prisma-middleware-tour-sold";

// Create a dedicated base client for tests
const basePrisma = new PrismaClient();

// Build the extended client (this is what we call writes on)
const testClient = attachTourSoldMiddleware(basePrisma);

// ── Fixture helpers ──────────────────────────────────────────────────────────
async function ensureTenant(id: string) {
  await basePrisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function ensureDepartment(id: string, tenantId: string) {
  await basePrisma.department.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: "Dept", slug: id },
  });
}

async function seedTour(opts: {
  id: string;
  tenantId: string;
  code: string;
  departmentId: string;
  capacity: number;
  sold?: number;
  status?: "ACTIVE" | "SOLD_OUT" | "DRAFT" | "CANCELLED" | "COMPLETED";
}) {
  return basePrisma.tour.create({
    data: {
      id: opts.id,
      tenantId: opts.tenantId,
      code: opts.code,
      name: `Tour ${opts.code}`,
      departmentId: opts.departmentId,
      startDate: new Date("2027-06-01"),
      endDate: new Date("2027-06-08"),
      capacity: opts.capacity,
      sold: opts.sold ?? 0,
      status: opts.status ?? "ACTIVE",
    },
  });
}

// Counter for generating unique mobile numbers across all tests in this file
let mobileCounter = 9000000;
const customerMobiles = new Map<string, string>();

async function ensureCustomer(id: string, tenantId: string) {
  if (!customerMobiles.has(id)) {
    customerMobiles.set(id, `+9199${++mobileCounter}`);
  }
  await basePrisma.customer.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      name: "Test Customer",
      mobile: customerMobiles.get(id)!,
    },
  });
}

async function clearTenant(tenantId: string) {
  await basePrisma.tourBooking.deleteMany({
    where: { tour: { tenantId } },
  });
  await basePrisma.tour.deleteMany({ where: { tenantId } });
  await basePrisma.customer.deleteMany({ where: { tenantId } });
  await basePrisma.department.deleteMany({ where: { tenantId } });
}

// Tenants used across tests
const TENANTS = ["t-mw-1", "t-mw-2", "t-mw-3", "t-mw-4"];

afterAll(async () => {
  for (const t of TENANTS) {
    await clearTenant(t).catch(() => {});
  }
  await basePrisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("attachTourSoldMiddleware", () => {

  // T21-1: Create CONFIRMED booking that fills capacity → SOLD_OUT
  it("creates CONFIRMED booking filling capacity → sold count updates, status flips to SOLD_OUT", async () => {
    const tenantId = "t-mw-1";
    const deptId = "dept-mw-1";
    const tourId = "tour-mw-1";
    const customerId = "cust-mw-1";

    await ensureTenant(tenantId);
    await ensureDepartment(deptId, tenantId);
    await seedTour({ id: tourId, tenantId, code: "MW-01", departmentId: deptId, capacity: 2 });
    await ensureCustomer(customerId, tenantId);

    // Create booking via the EXTENDED client (triggers extension hooks)
    await testClient.tourBooking.create({
      data: {
        tourId,
        customerId,
        seats: 2,
        status: "CONFIRMED",
      },
    });

    const tour = await basePrisma.tour.findUnique({ where: { id: tourId } });
    expect(tour?.sold).toBe(2);
    expect(tour?.status).toBe("SOLD_OUT");
  });

  // T21-2: Cancel a booking after SOLD_OUT → flips back to ACTIVE
  it("cancelling a booking after SOLD_OUT → sold count decreases, status flips back to ACTIVE", async () => {
    const tenantId = "t-mw-2";
    const deptId = "dept-mw-2";
    const tourId = "tour-mw-2";
    const custId1 = "cust-mw-2a";
    const custId2 = "cust-mw-2b";

    await ensureTenant(tenantId);
    await ensureDepartment(deptId, tenantId);
    await seedTour({ id: tourId, tenantId, code: "MW-02", departmentId: deptId, capacity: 2 });
    await ensureCustomer(custId1, tenantId);
    await ensureCustomer(custId2, tenantId);

    // Fill to capacity
    const b1 = await testClient.tourBooking.create({
      data: { tourId, customerId: custId1, seats: 1, status: "CONFIRMED" },
    });
    const b2 = await testClient.tourBooking.create({
      data: { tourId, customerId: custId2, seats: 1, status: "CONFIRMED" },
    });

    let tour = await basePrisma.tour.findUnique({ where: { id: tourId } });
    expect(tour?.status).toBe("SOLD_OUT");
    expect(tour?.sold).toBe(2);

    // Cancel one booking (update status to CANCELLED via extended client)
    await testClient.tourBooking.update({
      where: { id: b2.id },
      data: { status: "CANCELLED" },
    });

    tour = await basePrisma.tour.findUnique({ where: { id: tourId } });
    expect(tour?.sold).toBe(1);
    expect(tour?.status).toBe("ACTIVE");

    // Cleanup
    await basePrisma.tourBooking.delete({ where: { id: b1.id } });
  });

  // T21-3: WAITLISTED booking does NOT count toward sold
  it("WAITLISTED booking does not count toward sold, status remains ACTIVE", async () => {
    const tenantId = "t-mw-3";
    const deptId = "dept-mw-3";
    const tourId = "tour-mw-3";
    const customerId = "cust-mw-3";

    await ensureTenant(tenantId);
    await ensureDepartment(deptId, tenantId);
    // capacity = 1 — a WAITLISTED booking should NOT flip to SOLD_OUT
    await seedTour({ id: tourId, tenantId, code: "MW-03", departmentId: deptId, capacity: 1 });
    await ensureCustomer(customerId, tenantId);

    await testClient.tourBooking.create({
      data: {
        tourId,
        customerId,
        seats: 1,
        status: "WAITLISTED",
      },
    });

    const tour = await basePrisma.tour.findUnique({ where: { id: tourId } });
    expect(tour?.sold).toBe(0);
    expect(tour?.status).toBe("ACTIVE");
  });

  // T21-4: DRAFT/CANCELLED/COMPLETED tours are not auto-flipped
  it("DRAFT/CANCELLED/COMPLETED tours are not auto-flipped when bookings are created", async () => {
    const tenantId = "t-mw-4";
    const deptId = "dept-mw-4";
    const custId = "cust-mw-4";

    await ensureTenant(tenantId);
    await ensureDepartment(deptId, tenantId);
    await ensureCustomer(custId, tenantId);

    for (const [suffix, status] of [
      ["a", "DRAFT"],
      ["b", "CANCELLED"],
      ["c", "COMPLETED"],
    ] as const) {
      const tourId = `tour-mw-4${suffix}`;
      await seedTour({
        id: tourId,
        tenantId,
        code: `MW-04${suffix}`,
        departmentId: deptId,
        capacity: 1,
        status,
      });

      await testClient.tourBooking.create({
        data: { tourId, customerId: custId, seats: 1, status: "CONFIRMED" },
      });

      const tour = await basePrisma.tour.findUnique({ where: { id: tourId } });
      // Status must NOT change from DRAFT/CANCELLED/COMPLETED
      expect(tour?.status).toBe(status);
    }
  });
});
