"use client";

import * as React from "react";
import {
  Eye,
  X,
  Phone,
  Mail,
  RotateCcw,
  CheckCircle2,
  Clock,
  XCircle,
  MapPin,
  Ticket,
  IndianRupee,
} from "lucide-react";
import { useSession } from "next-auth/react";
import type { Role } from "@prisma/client";
import { hasPermission } from "@/modules/auth/rbac";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";

// ─── Types ──────────────────────────────────────────────────────────────────

type PaymentStatus =
  | "CREATED"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUND_PENDING"
  | "REFUNDED";

interface PaymentRow {
  id: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  seats: number;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  errorMessage: string | null;
  customer: { id: string; name: string; mobile: string; email?: string | null } | null;
  lead: { id: string; destination: string | null; travelDate?: string | null } | null;
  tour: { id: string; code: string; name: string; startDate?: string | null } | null;
  booking: { id: string; status: string; seats?: number; bookedAt?: string | null } | null;
}

interface Summary {
  capturedPaise: number;
  capturedCount: number;
  refundedPaise: number;
  refundedCount: number;
  refundPendingPaise: number;
  refundPendingCount: number;
  netPaise: number;
  totalCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inrExact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

function money(paise: number, exact = false): string {
  return (exact ? inrExact : inr).format(paise / 100);
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_META: Record<
  PaymentStatus,
  { label: string; variant: "default" | "info" | "warning" | "success" | "danger" | "primary" }
> = {
  CREATED: { label: "Created", variant: "default" },
  AUTHORIZED: { label: "Authorized", variant: "info" },
  CAPTURED: { label: "Captured", variant: "success" },
  FAILED: { label: "Failed", variant: "danger" },
  REFUND_PENDING: { label: "Refund Pending", variant: "warning" },
  REFUNDED: { label: "Refunded", variant: "primary" },
};

const FILTERS: Array<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "Captured", value: "CAPTURED" },
  { label: "Refund Pending", value: "REFUND_PENDING" },
  { label: "Refunded", value: "REFUNDED" },
  { label: "Failed", value: "FAILED" },
  { label: "Created", value: "CREATED" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = (session?.user?.role || "VIEWER") as Role;
  const canRefund = hasPermission(role, "payments:refund");

  const [payments, setPayments] = React.useState<PaymentRow[]>([]);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);

  // Detail panel
  const [selected, setSelected] = React.useState<PaymentRow | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);

  // Refund modal
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [refundMode, setRefundMode] = React.useState<"full" | "partial">("full");
  const [refundAmount, setRefundAmount] = React.useState("");
  const [refunding, setRefunding] = React.useState(false);

  // Show the spinner whenever the filter/page changes (render-phase adjustment
  // instead of a synchronous setLoading(true) inside the fetch effect).
  const fetchKey = `${statusFilter}|${page}`;
  const [lastFetchKey, setLastFetchKey] = React.useState(fetchKey);
  if (fetchKey !== lastFetchKey) {
    setLastFetchKey(fetchKey);
    setLoading(true);
  }

  // Callers outside the effect must setLoading(true) before invoking.
  const fetchPayments = React.useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));
    params.set("limit", "20");
    return fetch(`/api/payments?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setPayments(data.payments);
        setSummary(data.summary ?? null);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .catch(() => {
        toast("error", "Failed to load payments");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [statusFilter, page, toast]);

  React.useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  async function openDetail(payment: PaymentRow) {
    setSelected(payment);
    setPanelOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/payments/${payment.id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setSelected(data.payment);
    } catch {
      toast("error", "Failed to load payment details");
    } finally {
      setDetailLoading(false);
    }
  }

  function openRefund() {
    if (!selected) return;
    setRefundMode("full");
    setRefundAmount((selected.amountPaise / 100).toFixed(2));
    setRefundOpen(true);
  }

  async function submitRefund() {
    if (!selected) return;

    let amountPaise: number | undefined;
    if (refundMode === "partial") {
      const rupees = parseFloat(refundAmount);
      if (isNaN(rupees) || rupees <= 0) {
        toast("warning", "Enter a valid refund amount");
        return;
      }
      amountPaise = Math.round(rupees * 100);
      if (amountPaise > selected.amountPaise) {
        toast("warning", `Refund cannot exceed ${money(selected.amountPaise, true)}`);
        return;
      }
    }

    setRefunding(true);
    try {
      const res = await fetch(`/api/payments/${selected.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amountPaise ? { amountPaise } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refund failed");

      toast("success", data.message || "Refund initiated");
      setRefundOpen(false);
      // Reflect the new REFUND_PENDING status immediately, then refresh.
      setSelected((p) => (p ? { ...p, status: "REFUND_PENDING" } : p));
      setLoading(true);
      fetchPayments();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Refund failed");
    } finally {
      setRefunding(false);
    }
  }

  const statCards = summary
    ? [
        {
          label: "Net Collected",
          value: money(summary.netPaise),
          hint: "Captured − refunded",
          icon: IndianRupee,
          accent: "text-emerald-600 bg-emerald-50",
        },
        {
          label: "Captured",
          value: money(summary.capturedPaise),
          hint: `${summary.capturedCount} payment${summary.capturedCount === 1 ? "" : "s"}`,
          icon: CheckCircle2,
          accent: "text-primary-600 bg-primary-50",
        },
        {
          label: "Refunded",
          value: money(summary.refundedPaise),
          hint: `${summary.refundedCount} payment${summary.refundedCount === 1 ? "" : "s"}`,
          icon: RotateCcw,
          accent: "text-purple-600 bg-purple-50",
        },
        {
          label: "Refund Pending",
          value: money(summary.refundPendingPaise),
          hint: `${summary.refundPendingCount} in flight`,
          icon: Clock,
          accent: "text-amber-600 bg-amber-50",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle={total > 0 ? `${total} payment${total === 1 ? "" : "s"}` : "Payment history & refunds"}
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading && !summary
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[92px] animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            ))
          : statCards.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.label}
                  className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {c.label}
                    </p>
                    <p className="mt-1 truncate text-2xl font-bold text-gray-900">{c.value}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{c.hint}</p>
                  </div>
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${c.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              );
            })}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Payments table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-gray-500">
                      {statusFilter
                        ? "No payments match this filter."
                        : "No payments yet. Payments taken from a lead will appear here."}
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => openDetail(p)}>
                      <TableCell>
                        {p.customer ? (
                          <div className="flex items-center gap-3">
                            <Avatar name={p.customer.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">{p.customer.name}</p>
                              <p className="truncate text-xs text-gray-400">{p.customer.mobile}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">--</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.tour ? (
                          <span className="flex items-center gap-1.5 text-sm text-gray-700">
                            <Ticket className="h-3.5 w-3.5 text-gray-400" />
                            {p.tour.name}
                            <span className="text-gray-400">({p.tour.code})</span>
                          </span>
                        ) : p.lead?.destination ? (
                          <span className="flex items-center gap-1.5 text-sm text-gray-700">
                            <MapPin className="h-3.5 w-3.5 text-gray-400" />
                            {p.lead.destination}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">
                            {p.seats > 1 ? `${p.seats} seats` : "Booking"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-gray-900">
                        {money(p.amountPaise, true)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_META[p.status].variant} size="sm">
                          {STATUS_META[p.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {formatDateTime(p.paidAt || p.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(p);
                          }}
                          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="View details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
                <p className="text-sm text-gray-500">
                  Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
                </p>
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail slide-out panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/50" onClick={() => setPanelOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Payment Details</h2>
              <button
                onClick={() => setPanelOpen(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {detailLoading || !selected ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner size="lg" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Amount + status hero */}
                  <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5 text-center">
                    <p className="text-4xl font-bold tracking-tight text-gray-900">
                      {money(selected.amountPaise, true)}
                    </p>
                    <div className="mt-2 flex items-center justify-center gap-2">
                      <Badge variant={STATUS_META[selected.status].variant}>
                        {STATUS_META[selected.status].label}
                      </Badge>
                      <span className="text-sm text-gray-400">
                        {selected.seats > 1 ? `${selected.seats} seats` : "1 seat"}
                      </span>
                    </div>
                    {selected.errorMessage && (
                      <p className="mt-2 text-sm text-red-600">{selected.errorMessage}</p>
                    )}
                  </div>

                  {/* Customer */}
                  {selected.customer && (
                    <div className="space-y-2 rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={selected.customer.name} size="md" />
                        <div>
                          <p className="font-semibold text-gray-900">{selected.customer.name}</p>
                          <p className="text-xs text-gray-400">Customer</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <Phone className="h-4 w-4 text-gray-400" />
                        {selected.customer.mobile}
                      </div>
                      {selected.customer.email && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Mail className="h-4 w-4 text-gray-400" />
                          {selected.customer.email}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tour / booking */}
                  {(selected.tour || selected.lead?.destination) && (
                    <div className="space-y-2 rounded-lg border border-gray-200 p-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Booking
                      </h4>
                      {selected.tour ? (
                        <p className="flex items-center gap-2 text-sm text-gray-800">
                          <Ticket className="h-4 w-4 text-gray-400" />
                          {selected.tour.name}{" "}
                          <span className="text-gray-400">({selected.tour.code})</span>
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-sm text-gray-800">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          {selected.lead?.destination}
                        </p>
                      )}
                      {selected.booking && (
                        <p className="text-sm text-gray-500">
                          Booking status:{" "}
                          <span className="font-medium text-gray-700">{selected.booking.status}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Status timeline */}
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Timeline
                    </h4>
                    <Timeline payment={selected} />
                  </div>

                  {/* Razorpay references */}
                  <div className="space-y-1.5 rounded-lg border border-gray-200 p-4 text-sm">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      References
                    </h4>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">Order ID</span>
                      <span className="truncate font-mono text-xs text-gray-700">
                        {selected.razorpayOrderId}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">Payment ID</span>
                      <span className="truncate font-mono text-xs text-gray-700">
                        {selected.razorpayPaymentId || "--"}
                      </span>
                    </div>
                  </div>

                  {/* Refund action */}
                  {canRefund && selected.status === "CAPTURED" && (
                    <Button variant="danger" className="w-full" onClick={openRefund}>
                      <RotateCcw className="h-4 w-4" />
                      Refund Payment
                    </Button>
                  )}
                  {selected.status === "REFUND_PENDING" && (
                    <p className="rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                      Refund in progress — awaiting confirmation from Razorpay.
                    </p>
                  )}
                  {selected.status === "REFUNDED" && (
                    <p className="rounded-lg bg-purple-50 px-4 py-3 text-center text-sm text-purple-700">
                      Refunded on {formatDateTime(selected.refundedAt)}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Refund modal */}
      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Refund Payment">
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Refunding <span className="font-semibold text-gray-900">{selected.customer?.name}</span> for{" "}
              <span className="font-semibold text-gray-900">
                {selected.tour?.name || selected.lead?.destination || "this booking"}
              </span>
              . Captured amount: <span className="font-semibold">{money(selected.amountPaise, true)}</span>.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setRefundMode("full");
                  setRefundAmount((selected.amountPaise / 100).toFixed(2));
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  refundMode === "full"
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Full refund
              </button>
              <button
                onClick={() => setRefundMode("partial")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  refundMode === "partial"
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                Partial refund
              </button>
            </div>

            {refundMode === "partial" && (
              <Input
                label="Refund amount (₹)"
                type="number"
                min="0"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="0.00"
              />
            )}

            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              This initiates a refund via Razorpay. The status becomes <strong>Refund Pending</strong>{" "}
              until Razorpay confirms, then flips to <strong>Refunded</strong> and cancels the booking.
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="secondary" onClick={() => setRefundOpen(false)} disabled={refunding}>
                Cancel
              </Button>
              <Button variant="danger" onClick={submitRefund} loading={refunding}>
                {refundMode === "full"
                  ? `Refund ${money(selected.amountPaise)}`
                  : "Refund amount"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── Status timeline ──────────────────────────────────────────────────────────

function Timeline({ payment }: { payment: PaymentRow }) {
  const failed = payment.status === "FAILED";

  const steps: Array<{ label: string; at: string | null; done: boolean; icon: typeof CheckCircle2 }> = [
    {
      label: "Order created",
      at: payment.createdAt,
      done: true,
      icon: CheckCircle2,
    },
    {
      label: failed ? "Payment failed" : "Payment captured",
      at: payment.paidAt,
      done: !failed && ["CAPTURED", "REFUND_PENDING", "REFUNDED"].includes(payment.status),
      icon: failed ? XCircle : CheckCircle2,
    },
  ];

  if (["REFUND_PENDING", "REFUNDED"].includes(payment.status)) {
    steps.push({
      label: "Refund initiated",
      at: null,
      done: true,
      icon: RotateCcw,
    });
  }
  if (payment.status === "REFUNDED") {
    steps.push({
      label: "Refunded",
      at: payment.refundedAt,
      done: true,
      icon: CheckCircle2,
    });
  }

  return (
    <ol className="space-y-4">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const isFail = failed && i === 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
                  isFail
                    ? "bg-red-100 text-red-600"
                    : s.done
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              {i < steps.length - 1 && <span className="mt-1 h-6 w-px bg-gray-200" />}
            </div>
            <div className="pt-0.5">
              <p className={`text-sm font-medium ${isFail ? "text-red-700" : "text-gray-800"}`}>
                {s.label}
              </p>
              {s.at && <p className="text-xs text-gray-400">{formatDateTime(s.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
