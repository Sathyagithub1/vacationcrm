/**
 * Tests for getRevenue — revenue aggregation from payments.
 * prisma is fully mocked; no DB is used.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPaymentFindMany } = vi.hoisted(() => ({ mockPaymentFindMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { payment: { findMany: mockPaymentFindMany } },
}));

import { getRevenue } from "./reports.service";

const RANGE = { tenantId: "t1", dateFrom: "2026-01-01", dateTo: "2026-12-31" };

beforeEach(() => vi.clearAllMocks());

describe("getRevenue", () => {
  it("sums captured revenue, refunds, and net; computes avg order value", async () => {
    mockPaymentFindMany.mockResolvedValue([
      { amountPaise: 50000, status: "CAPTURED", paidAt: new Date("2026-03-10"), refundedAt: null },
      { amountPaise: 20000, status: "REFUNDED", paidAt: new Date("2026-03-15"), refundedAt: new Date("2026-04-02") },
      { amountPaise: 30000, status: "CAPTURED", paidAt: new Date("2026-04-20"), refundedAt: null },
    ]);

    const { summary, rows } = await getRevenue(RANGE);

    // Captured = 50000 + 20000 + 30000 = 100000 paise = ₹1000
    expect(summary.totalRevenue).toBe(1000);
    // Refunds = 20000 paise = ₹200
    expect(summary.refunds).toBe(200);
    // Net = 800
    expect(summary.netRevenue).toBe(800);
    // 3 captured payments
    expect(summary.payments).toBe(3);
    // avg = 1000 / 3 = 333.33
    expect(summary.avgOrderValue).toBe(333.33);

    // Buckets: March (captured 700, count 2), April (captured 300 + refund 200)
    const march = rows.find((r) => r.period === "2026-03");
    const april = rows.find((r) => r.period === "2026-04");
    expect(march).toMatchObject({ capturedRevenue: 700, refunds: 0, netRevenue: 700, payments: 2 });
    expect(april).toMatchObject({ capturedRevenue: 300, refunds: 200, netRevenue: 100, payments: 1 });
    // Rows sorted ascending by period
    expect(rows.map((r) => r.period)).toEqual(["2026-03", "2026-04"]);
  });

  it("ignores CREATED/FAILED payments (no paidAt)", async () => {
    mockPaymentFindMany.mockResolvedValue([
      { amountPaise: 99999, status: "CREATED", paidAt: null, refundedAt: null },
      { amountPaise: 88888, status: "FAILED", paidAt: null, refundedAt: null },
    ]);
    const { summary, rows } = await getRevenue(RANGE);
    expect(summary.totalRevenue).toBe(0);
    expect(summary.payments).toBe(0);
    expect(summary.avgOrderValue).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("scopes by agent through the lead relation for AGENT role", async () => {
    mockPaymentFindMany.mockResolvedValue([]);
    await getRevenue({ ...RANGE, scopedAssignedTo: "agent-9" });
    const call = mockPaymentFindMany.mock.calls[0][0];
    expect(call.where.lead).toEqual({ assignedTo: "agent-9" });
  });
});
