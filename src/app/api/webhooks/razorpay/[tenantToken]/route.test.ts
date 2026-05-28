/**
 * src/app/api/webhooks/razorpay/[tenantToken]/route.test.ts
 *
 * Phase 6c — Razorpay webhook handler tests.
 *
 * Tests cover:
 *   - payment.captured → Payment CAPTURED + TourBooking CONFIRMED
 *   - payment.failed   → Payment FAILED + errorMessage
 *   - refund.processed → Payment REFUNDED + TourBooking CANCELLED
 *   - Bad signature    → 401
 *   - Unknown tenant   → 401
 *   - Missing webhook secret → 412
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

// ── Hoist mock functions ──────────────────────────────────────────────────────
const {
  mockTenantFindUnique,
  mockPaymentFindUnique,
  mockPaymentUpdate,
  mockTourBookingCreate,
  mockTourBookingUpdate,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockPaymentFindUnique: vi.fn(),
  mockPaymentUpdate: vi.fn(),
  mockTourBookingCreate: vi.fn(),
  mockTourBookingUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    payment: {
      findUnique: mockPaymentFindUnique,
      update: mockPaymentUpdate,
    },
    tourBooking: {
      create: mockTourBookingCreate,
      update: mockTourBookingUpdate,
    },
  },
}));

import { POST } from "./route";

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-rzp-wh-1";
const INTAKE_TOKEN = "intake-token-rzp-1";
const WH_SECRET = "wh_secret_razorpay_test";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSig(body: string): string {
  return createHmac("sha256", WH_SECRET).update(body, "utf8").digest("hex");
}

function makeWebhookRequest(event: string, payload: unknown, signature?: string): NextRequest {
  const body = JSON.stringify({ event, payload });
  const sig = signature ?? buildSig(body);
  return new NextRequest(`http://localhost/api/webhooks/razorpay/${INTAKE_TOKEN}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": sig,
    },
  });
}

function setTenantMock(configured = true) {
  mockTenantFindUnique.mockResolvedValue(
    configured
      ? { id: TENANT_ID, razorpayWebhookSecret: WH_SECRET }
      : { id: TENANT_ID, razorpayWebhookSecret: null },
  );
}

const routeContext = {
  params: Promise.resolve({ tenantToken: INTAKE_TOKEN }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Razorpay webhook — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 for unknown tenant token", async () => {
    mockTenantFindUnique.mockResolvedValue(null);

    const req = makeWebhookRequest("payment.captured", {});
    const res = await POST(req, routeContext);
    expect(res.status).toBe(401);
  });

  it("returns 412 when webhook secret is not configured", async () => {
    setTenantMock(false);

    const req = makeWebhookRequest("payment.captured", {});
    const res = await POST(req, routeContext);
    expect(res.status).toBe(412);
  });

  it("returns 401 for invalid signature", async () => {
    setTenantMock();

    const req = makeWebhookRequest("payment.captured", {}, "badhex0000000000");
    const res = await POST(req, routeContext);
    expect(res.status).toBe(401);
  });
});

describe("Razorpay webhook — payment.captured", () => {
  beforeEach(() => vi.clearAllMocks());

  it("captures payment and creates TourBooking on payment.captured", async () => {
    setTenantMock();

    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-db-1",
      tenantId: TENANT_ID,
      tourId: "tour-1",
      seats: 2,
      customerId: "cust-1",
      leadId: "lead-1",
      status: "CREATED",
      bookingId: null,
    });

    mockPaymentUpdate
      .mockResolvedValueOnce({
        id: "pay-db-1",
        tourId: "tour-1",
        seats: 2,
        customerId: "cust-1",
        leadId: "lead-1",
        bookingId: null,
      })
      .mockResolvedValueOnce({ id: "pay-db-1" });

    mockTourBookingCreate.mockResolvedValue({ id: "booking-new-1" });

    const payload = {
      payment: {
        entity: {
          id: "pay_razorpay_001",
          order_id: "order_TEST001",
          amount: 50000,
          status: "captured",
        },
      },
    };

    const req = makeWebhookRequest("payment.captured", payload);
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Payment updated to CAPTURED
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay-db-1" },
        data: expect.objectContaining({ status: "CAPTURED" }),
      }),
    );

    // TourBooking created with CONFIRMED status
    expect(mockTourBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMED", tourId: "tour-1", seats: 2 }),
      }),
    );
  });

  it("is idempotent — does not re-process already CAPTURED payment", async () => {
    setTenantMock();

    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-db-2",
      tenantId: TENANT_ID,
      status: "CAPTURED", // already captured
    });

    const payload = {
      payment: {
        entity: { id: "pay_rzp_002", order_id: "order_002", amount: 1000, status: "captured" },
      },
    };

    const req = makeWebhookRequest("payment.captured", payload);
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);
    // No update should have been issued
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });
});

describe("Razorpay webhook — payment.failed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks payment as FAILED with error message", async () => {
    setTenantMock();

    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-db-3",
      tenantId: TENANT_ID,
      status: "CREATED",
    });
    mockPaymentUpdate.mockResolvedValue({ id: "pay-db-3" });

    const payload = {
      payment: {
        entity: {
          id: "pay_fail_001",
          order_id: "order_FAIL001",
          error_description: "Insufficient funds",
          error_code: "BAD_REQUEST_ERROR",
        },
      },
    };

    const req = makeWebhookRequest("payment.failed", payload);
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});

describe("Razorpay webhook — refund.processed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks payment REFUNDED and cancels TourBooking", async () => {
    setTenantMock();

    mockPaymentFindUnique.mockResolvedValue({
      id: "pay-db-4",
      tenantId: TENANT_ID,
      bookingId: "booking-existing-1",
      status: "REFUND_PENDING",
    });
    mockPaymentUpdate.mockResolvedValue({ id: "pay-db-4" });
    mockTourBookingUpdate.mockResolvedValue({ id: "booking-existing-1" });

    const payload = {
      refund: {
        entity: {
          id: "rfnd_001",
          payment_id: "pay_rzp_captured_001",
          amount: 50000,
          status: "processed",
        },
      },
    };

    const req = makeWebhookRequest("refund.processed", payload);
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);

    // Payment set to REFUNDED
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REFUNDED" }),
      }),
    );

    // Booking cancelled
    expect(mockTourBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-existing-1" },
        data: { status: "CANCELLED" },
      }),
    );
  });
});

describe("Razorpay webhook — unknown events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 for unrecognised events (ack without processing)", async () => {
    setTenantMock();

    const req = makeWebhookRequest("order.paid", { order: { entity: { id: "order_x" } } });
    const res = await POST(req, routeContext);

    expect(res.status).toBe(200);
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });
});
