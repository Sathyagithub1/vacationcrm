"use client";

/**
 * src/app/settings/payments/page.tsx
 *
 * Phase 6c — Payments reconciliation page.
 *
 * Lists recent payments for the tenant with:
 *   - Status badges (CREATED / CAPTURED / REFUNDED / FAILED / REFUND_PENDING)
 *   - Customer name + mobile
 *   - Tour and booking link
 *   - Date filters + status filter
 *   - Reconciliation summary: total captured, refunded, pending in range
 */

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type PaymentStatus = "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUND_PENDING" | "REFUNDED";

interface PaymentRow {
  id: string;
  status: PaymentStatus;
  amountPaise: number;
  currency: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  seats: number;
  customer: { id: string; name: string; mobile: string } | null;
  lead: { id: string; destination: string | null } | null;
  tour: { id: string; code: string; name: string } | null;
  booking: { id: string; status: string } | null;
}

interface PaymentsResponse {
  payments: PaymentRow[];
  total: number;
  page: number;
  totalPages: number;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<PaymentStatus, string> = {
  CREATED: "bg-gray-100 text-gray-700",
  AUTHORIZED: "bg-blue-100 text-blue-700",
  CAPTURED: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
  REFUND_PENDING: "bg-yellow-100 text-yellow-700",
  REFUNDED: "bg-purple-100 text-purple-700",
};

function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ── Reconciliation summary ────────────────────────────────────────────────────

function ReconciliationSummary({ payments }: { payments: PaymentRow[] }) {
  const captured = payments
    .filter((p) => p.status === "CAPTURED")
    .reduce((sum, p) => sum + p.amountPaise, 0);

  const refunded = payments
    .filter((p) => p.status === "REFUNDED" || p.status === "REFUND_PENDING")
    .reduce((sum, p) => sum + p.amountPaise, 0);

  const pending = payments
    .filter((p) => p.status === "CREATED" || p.status === "AUTHORIZED")
    .reduce((sum, p) => sum + p.amountPaise, 0);

  const fmt = (paise: number) =>
    paise > 0
      ? `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
      : "—";

  return (
    <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">Captured</p>
        <p className="mt-1 text-xl font-semibold text-emerald-700">{fmt(captured)}</p>
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">Refunded</p>
        <p className="mt-1 text-xl font-semibold text-purple-700">{fmt(refunded)}</p>
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
        <p className="mt-1 text-xl font-semibold text-yellow-700">{fmt(pending)}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [data, setData] = useState<PaymentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/payments?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load payments");
      const json = (await res.json()) as PaymentsResponse;
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-500">Razorpay payment reconciliation</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">All statuses</option>
            <option value="CREATED">Created</option>
            <option value="CAPTURED">Captured</option>
            <option value="FAILED">Failed</option>
            <option value="REFUND_PENDING">Refund Pending</option>
            <option value="REFUNDED">Refunded</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => { setStatusFilter(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Reconciliation summary */}
      {data && <ReconciliationSummary payments={data.payments} />}

      {/* Table */}
      {loading && <p className="text-sm text-gray-500">Loading payments…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && data && (
        <>
          {data.payments.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
              No payments found for the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Tour</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Razorpay Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.payments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {format(new Date(p.createdAt), "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3">
                        {p.customer ? (
                          <div>
                            <p className="font-medium text-gray-900">{p.customer.name}</p>
                            <p className="text-xs text-gray-500">{p.customer.mobile}</p>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.tour ? (
                          <div>
                            <p className="font-medium text-gray-900">{p.tour.name}</p>
                            <p className="text-xs text-gray-500">{p.seats} seat{p.seats !== 1 ? "s" : ""}</p>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        ₹{(p.amountPaise / 100).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                        {p.razorpayOrderId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-500">
                Showing {(data.page - 1) * 20 + 1}–{Math.min(data.page * 20, data.total)} of {data.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                  className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
