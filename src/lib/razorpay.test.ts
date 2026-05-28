/**
 * src/lib/razorpay.test.ts
 *
 * Unit tests for the Razorpay SDK client wrapper (Phase 6f).
 *
 * Phase 6c used a manual https.request client.
 * Phase 6f uses the official `razorpay` npm SDK.
 * These tests mock the SDK methods rather than https.request.
 *
 * All tests mock external HTTP calls and prisma — no real Razorpay API calls
 * are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Hoist mock function references ────────────────────────────────────────────
const { mockFindUnique, mockOrdersCreate, mockPaymentsRefund } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockOrdersCreate: vi.fn(),
  mockPaymentsRefund: vi.fn(),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mockFindUnique,
    },
  },
}));

// ── Razorpay SDK mock ─────────────────────────────────────────────────────────
// vi.fn().mockImplementation() doesn't reliably support `new` in some vitest
// versions — use a real class so `new Razorpay(opts)` returns an instance with
// the mocked methods attached.
vi.mock("razorpay", () => {
  class MockRazorpay {
    orders = { create: mockOrdersCreate };
    payments = { refund: mockPaymentsRefund };
    constructor(_opts: { key_id: string; key_secret: string }) {
      void _opts;
    }
    static validateWebhookSignature(body: string, signature: string, secret: string): boolean {
      const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
      return expected === signature;
    }
  }
  return { default: MockRazorpay };
});

// ── Import modules under test (after mocks are declared) ─────────────────────
import {
  verifyWebhookSignature,
  createOrder,
  refundPayment,
  getTenantCredentials,
} from "./razorpay";

// ── Test helpers ──────────────────────────────────────────────────────────────

function buildHmac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function setTenantCreds(
  keyId: string | null,
  keySecret: string | null,
  webhookSecret?: string | null,
) {
  mockFindUnique.mockResolvedValue({
    razorpayKeyId: keyId,
    razorpayKeySecret: keySecret,
    razorpayWebhookSecret: webhookSecret ?? null,
  });
}

// ── Webhook signature tests ───────────────────────────────────────────────────

describe("verifyWebhookSignature", () => {
  const SECRET = "wh_secret_abc";
  const BODY = '{"event":"payment.captured","payload":{}}';

  it("accepts a valid HMAC-SHA256 signature", () => {
    const sig = buildHmac(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = buildHmac(BODY, SECRET);
    expect(verifyWebhookSignature(BODY.replace("captured", "failed"), sig, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = buildHmac(BODY, "wrong_secret");
    expect(verifyWebhookSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("rejects empty signature", () => {
    expect(verifyWebhookSignature(BODY, "", SECRET)).toBe(false);
  });

  it("rejects empty body", () => {
    expect(verifyWebhookSignature("", buildHmac(BODY, SECRET), SECRET)).toBe(false);
  });
});

// ── createOrder tests ─────────────────────────────────────────────────────────

describe("createOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns orderId, amount and currency from SDK response", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockOrdersCreate.mockResolvedValue({
      id: "order_ABC123",
      amount: 50000,
      currency: "INR",
      receipt: "rcpt_001",
      status: "created",
    });

    const result = await createOrder("tenant-1", {
      amountPaise: 50000,
      currency: "INR",
      receipt: "rcpt_001",
      notes: { tourId: "tour-1", seats: "2" },
    });

    expect(result).toMatchObject({
      orderId: "order_ABC123",
      amount: 50000,
      currency: "INR",
      status: "created",
    });
  });

  it("passes correct params to SDK (amount, currency, receipt, notes)", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockOrdersCreate.mockResolvedValue({
      id: "order_XYZ",
      amount: 10000,
      currency: "INR",
      receipt: "rcpt_tour_1",
      status: "created",
    });

    await createOrder("tenant-1", {
      amountPaise: 10000,
      currency: "INR",
      receipt: "rcpt_tour_1",
      notes: { tourId: "tour-99" },
    });

    expect(mockOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10000,
        currency: "INR",
        receipt: "rcpt_tour_1",
        notes: { tourId: "tour-99" },
      }),
    );
  });

  it("throws when Razorpay SDK throws (e.g. invalid amount)", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockOrdersCreate.mockRejectedValue(new Error("Amount must be a positive integer"));

    await expect(
      createOrder("tenant-1", { amountPaise: -1 }),
    ).rejects.toThrow("Amount must be a positive integer");
  });

  it("throws when tenant has no Razorpay credentials", async () => {
    setTenantCreds(null, null);

    await expect(
      createOrder("tenant-unconfigured", { amountPaise: 10000 }),
    ).rejects.toThrow("Razorpay credentials not configured");
  });
});

// ── refundPayment tests ───────────────────────────────────────────────────────

describe("refundPayment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns refundId and status from SDK response", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockPaymentsRefund.mockResolvedValue({
      id: "rfnd_XYZ789",
      payment_id: "pay_PAY001",
      amount: 50000,
      currency: "INR",
      status: "processed",
    });

    const result = await refundPayment("tenant-1", "pay_PAY001");

    expect(result).toMatchObject({
      refundId: "rfnd_XYZ789",
      paymentId: "pay_PAY001",
      amount: 50000,
      status: "processed",
    });
  });

  it("passes amount for partial refunds", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockPaymentsRefund.mockResolvedValue({
      id: "rfnd_PARTIAL",
      payment_id: "pay_PAY002",
      amount: 20000,
      currency: "INR",
      status: "processed",
    });

    const result = await refundPayment("tenant-1", "pay_PAY002", 20000);
    expect(result.amount).toBe(20000);
    expect(result.refundId).toBe("rfnd_PARTIAL");
    expect(mockPaymentsRefund).toHaveBeenCalledWith("pay_PAY002", { amount: 20000 });
  });

  it("omits amount for full refunds", async () => {
    setTenantCreds("rzp_test_key", "rzp_test_secret");
    mockPaymentsRefund.mockResolvedValue({
      id: "rfnd_FULL",
      payment_id: "pay_FULL001",
      amount: 100000,
      currency: "INR",
      status: "processed",
    });

    await refundPayment("tenant-1", "pay_FULL001");
    // When amountPaise is undefined, body should be empty {}
    expect(mockPaymentsRefund).toHaveBeenCalledWith("pay_FULL001", {});
  });
});

// ── Cross-tenant isolation tests ──────────────────────────────────────────────

describe("Cross-tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads credentials specific to the requested tenant, not another tenant", async () => {
    mockFindUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        if (where.id === "tenant-A") {
          return Promise.resolve({
            razorpayKeyId: "key_A",
            razorpayKeySecret: "secret_A",
            razorpayWebhookSecret: null,
          });
        }
        if (where.id === "tenant-B") {
          return Promise.resolve({
            razorpayKeyId: "key_B",
            razorpayKeySecret: "secret_B",
            razorpayWebhookSecret: null,
          });
        }
        return Promise.resolve(null);
      },
    );

    const credsA = await getTenantCredentials("tenant-A");
    const credsB = await getTenantCredentials("tenant-B");

    expect(credsA.keyId).toBe("key_A");
    expect(credsB.keyId).toBe("key_B");
    expect(credsA.keyId).not.toBe(credsB.keyId);
    expect(credsA.keySecret).not.toBe(credsB.keySecret);
  });

  it("throws for an unknown tenant", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getTenantCredentials("ghost-tenant")).rejects.toThrow(
      "Tenant not found",
    );
  });
});
