/**
 * src/app/api/tours/route.test.ts
 *
 * T39 tests — Tours + bookings CRUD.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { GET, POST } from "./route";
import { POST as createBooking } from "./[id]/bookings/route";
import { PATCH as patchBooking } from "./[id]/bookings/[bookingId]/route";

const T_ADMIN = "t-tour-admin";
const T_OTHER = "t-tour-other";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function seedDept(tenantId: string): Promise<string> {
  const id = `dept-tour-${tenantId}`;
  await prisma.department.upsert({
    where: { id }, update: {},
    create: { id, tenantId, name: "Tours", slug: `tours-${tenantId}` },
  });
  return id;
}

async function clearTenant(t: string) {
  await prisma.tourBooking.deleteMany({ where: { tour: { tenantId: t } } });
  await prisma.customer.deleteMany({ where: { tenantId: t } });
  await prisma.tour.deleteMany({ where: { tenantId: t } });
  await prisma.department.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function postTourReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tours", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postBookingReq(tourId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tours/${tourId}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchBookingReq(tourId: string, bookingId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tours/${tourId}/bookings/${bookingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  for (const t of [T_ADMIN, T_OTHER]) {
    await prisma.tenant.upsert({ where: { id: t }, update: {}, create: { id: t, name: t, slug: t } });
    await clearTenant(t);
    await prisma.user.upsert({
      where: { id: `u-${t}` }, update: {},
      create: { id: `u-${t}`, tenantId: t, email: `u@${t}.com`, passwordHash: "x", name: "Admin", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
  }
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_OTHER]) await clearTenant(t);
  await prisma.$disconnect();
});

describe("T39 Tours + bookings CRUD", () => {

  it("POST creates tour → 201 with tour; capacity ≥ 1 validated", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);

    const res = await POST(postTourReq({
      code: "BALI2027", name: "Bali 2027", departmentId: deptId,
      startDate: "2027-06-01", endDate: "2027-06-08", capacity: 20,
    }));
    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect((json.tour as Record<string, unknown>).code).toBe("BALI2027");
    expect((json.tour as Record<string, unknown>).status).toBe("ACTIVE");
  });

  it("POST rejects capacity < 1", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);

    const res = await POST(postTourReq({
      code: "ZERO-CAP", name: "Zero Cap Tour", departmentId: deptId,
      startDate: "2027-06-01", endDate: "2027-06-08", capacity: 0,
    }));
    expect(res.status).toBe(400);
  });

  it("POST rejects duplicate code within same tenant → 409", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);

    const tourData = { code: "DUP-CODE", name: "Dup Tour", departmentId: deptId,
      startDate: "2027-07-01", endDate: "2027-07-08", capacity: 10 };

    await POST(postTourReq(tourData));
    const res2 = await POST(postTourReq(tourData));
    expect(res2.status).toBe(409);
  });

  it("booking create triggers sold-count middleware; full sold → status SOLD_OUT", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);

    // Create a tour with capacity 1
    const tourRes = await POST(postTourReq({
      code: "SOLD-T39", name: "Sold Out Tour T39", departmentId: deptId,
      startDate: "2027-08-01", endDate: "2027-08-08", capacity: 1,
    }));
    const { tour } = await tourRes.json() as { tour: { id: string } };

    const cust = await prisma.customer.create({ data: { tenantId: T_ADMIN, name: "Cust T39", mobile: "+919900000010" } });

    const bookRes = await createBooking(
      postBookingReq(tour.id, { customerId: cust.id, seats: 1 }),
      { params: Promise.resolve({ id: tour.id }) },
    );
    expect(bookRes.status).toBe(201);
    const bookJson = await bookRes.json() as Record<string, unknown>;
    // Middleware must have flipped status to SOLD_OUT
    expect((bookJson.tour as Record<string, unknown>).status).toBe("SOLD_OUT");
    expect((bookJson.tour as Record<string, unknown>).sold).toBe(1);
  });

  it("booking cancellation reverses sold-out flip → back to ACTIVE", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);

    const tourRes = await POST(postTourReq({
      code: "CANCEL-T39", name: "Cancel Test T39", departmentId: deptId,
      startDate: "2027-09-01", endDate: "2027-09-08", capacity: 1,
    }));
    const { tour } = await tourRes.json() as { tour: { id: string } };

    const cust = await prisma.customer.create({ data: { tenantId: T_ADMIN, name: "Cust2 T39", mobile: "+919900000011" } });
    const bookRes = await createBooking(
      postBookingReq(tour.id, { customerId: cust.id, seats: 1 }),
      { params: Promise.resolve({ id: tour.id }) },
    );
    const { booking } = await bookRes.json() as { booking: { id: string } };

    // Cancel the booking
    const cancelRes = await patchBooking(
      patchBookingReq(tour.id, booking.id, { status: "CANCELLED" }),
      { params: Promise.resolve({ id: tour.id, bookingId: booking.id }) },
    );
    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json() as Record<string, unknown>;
    expect((cancelJson.tour as Record<string, unknown>).status).toBe("ACTIVE");
    expect((cancelJson.tour as Record<string, unknown>).sold).toBe(0);
  });

  it("tenant isolation: tenant B cannot list tenant A tours", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const deptId = await seedDept(T_ADMIN);
    await POST(postTourReq({
      code: "ISOLATED", name: "Isolated Tour", departmentId: deptId,
      startDate: "2027-10-01", endDate: "2027-10-08", capacity: 5,
    }));

    setSession(T_OTHER, "COMPANY_ADMIN");
    const res = await GET(new NextRequest("http://localhost/api/tours"));
    const json = await res.json() as Record<string, unknown>;
    const tours = json.tours as Array<Record<string, unknown>>;
    expect(tours.every((t) => t.code !== "ISOLATED")).toBe(true);
  });
});
