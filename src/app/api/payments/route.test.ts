/**
 * src/app/api/payments/route.test.ts
 *
 * Phase 6c — Tests for POST /api/payments and GET /api/payments.
 *
 * Mocks: requirePermission/requireAuth, razorpay createOrder, prisma payment.create
 * Real DB is NOT used here — all prisma calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const { mockRequireAuth, mockRequirePermission, mockCreateOrder } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequirePermission: vi.fn(),
  mockCreateOrder: vi.fn(),
}));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requireAuth: mockRequireAuth,
  requirePermission: mockRequirePermission,
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));

vi.mock("@/lib/razorpay", () => ({
  createOrder: mockCreateOrder,
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
const { mockPaymentCreate, mockPaymentFindMany, mockPaymentCount, mockCustomerFindFirst, mockTenantFindUnique } = vi.hoisted(() => ({
  mockPaymentCreate: vi.fn(),
  mockPaymentFindMany: vi.fn(),
  mockPaymentCount: vi.fn(),
  mockCustomerFindFirst: vi.fn(),
  mockTenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
  },
}));

import { POST, GET } from "./route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDbMock(overrides: Record<string, unknown> = {}) {
  return {
    payment: {
      create: mockPaymentCreate,
      findMany: mockPaymentFindMany,
      count: mockPaymentCount,
    },
    customer: { findFirst: mockCustomerFindFirst },
    ...overrides,
  };
}

function makeMockSession(tenantId = "tenant-pay-1") {
  const db = makeDbMock();
  mockRequirePermission.mockResolvedValue({ user: { id: "user-1", tenantId, role: "COMPANY_ADMIN" }, db });
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1", tenantId, role: "COMPANY_ADMIN" }, db });
  return db;
}

function makeNextRequest(body: unknown, url = "http://localhost/api/payments"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── POST /api/payments ────────────────────────────────────────────────────────

describe("POST /api/payments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a Razorpay order and Payment row, returns order details", async () => {
    const db = makeMockSession();

    mockCustomerFindFirst.mockResolvedValue({ id: "cust-1", name: "Alice", mobile: "9999999999" });
    mockCreateOrder.mockResolvedValue({
      orderId: "order_TEST123",
      amount: 50000,
      currency: "INR",
      status: "created",
    });
    mockPaymentCreate.mockResolvedValue({ id: "pay-row-1" });
    mockTenantFindUnique.mockResolvedValue({ razorpayKeyId: "rzp_test_key" });

    const req = makeNextRequest({ customerId: "cust-1", amountPaise: 50000, seats: 2 });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.razorpayOrderId).toBe("order_TEST123");
    expect(json.amount).toBe(50000);
    expect(json.paymentId).toBe("pay-row-1");
    expect(json.razorpayKeyId).toBe("rzp_test_key");
  });

  it("returns 400 when customerId is missing", async () => {
    makeMockSession();

    const req = makeNextRequest({ amountPaise: 10000 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("customerId");
  });

  it("returns 400 when amountPaise is zero or negative", async () => {
    makeMockSession();

    const req = makeNextRequest({ customerId: "cust-1", amountPaise: 0 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("amountPaise");
  });

  it("returns 412 when Razorpay credentials are not configured", async () => {
    makeMockSession();

    mockCustomerFindFirst.mockResolvedValue({ id: "cust-1" });
    mockCreateOrder.mockRejectedValue(new Error("Razorpay credentials not configured for tenant"));

    const req = makeNextRequest({ customerId: "cust-1", amountPaise: 5000 });
    const res = await POST(req);
    expect(res.status).toBe(412);
  });

  it("returns 404 when customer not found", async () => {
    makeMockSession();
    mockCustomerFindFirst.mockResolvedValue(null);

    const req = makeNextRequest({ customerId: "nonexistent", amountPaise: 5000 });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});

// ── GET /api/payments ─────────────────────────────────────────────────────────

describe("GET /api/payments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated payments list with tenant scoping", async () => {
    const db = makeMockSession();

    mockPaymentFindMany.mockResolvedValue([
      { id: "p1", status: "CAPTURED", amountPaise: 50000 },
      { id: "p2", status: "CREATED", amountPaise: 20000 },
    ]);
    mockPaymentCount.mockResolvedValue(2);

    const req = new NextRequest("http://localhost/api/payments?page=1&limit=20");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.payments).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
  });

  it("filters by status query param", async () => {
    const db = makeMockSession();

    mockPaymentFindMany.mockResolvedValue([{ id: "p1", status: "CAPTURED" }]);
    mockPaymentCount.mockResolvedValue(1);

    const req = new NextRequest("http://localhost/api/payments?status=CAPTURED");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.payments[0].status).toBe("CAPTURED");
    // Verify findMany was called with status filter
    expect(mockPaymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "CAPTURED" }),
      }),
    );
  });
});
