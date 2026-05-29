"use client";

/**
 * src/components/leads/book-tour-card.tsx
 *
 * Phase 6i — Tour booking surface on lead detail.
 *
 * Closes the highest-impact agent workflow gap identified by the UX audit:
 * agents previously could not initiate a tour booking + payment from inside
 * a lead — tour inventory lived only in /settings/tours and TakePaymentButton
 * had no UI host.
 *
 * Flow:
 *   1. Agent picks a tour from the active list (capacity remaining shown).
 *   2. Enters seats + price in INR (Tours don't carry a per-seat price in
 *      the schema today — agent quotes the amount).
 *   3. TakePaymentButton renders with customerId+leadId+tourId+seats+amountPaise.
 *   4. On success the parent's onBooked() refetches the lead so the new
 *      payment + booking appear in the activity timeline.
 *
 * NEVER hardcode currency — INR is what the payments API uses everywhere
 * today; once multi-currency lands, derive from the tour or tenant.
 */

import * as React from "react";
import { Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { TakePaymentButton } from "@/components/payments/TakePaymentButton";

interface Tour {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  capacity: number;
  sold: number;
  status: string;
}

interface ToursListResponse {
  tours: Tour[];
}

interface BookTourCardProps {
  customerId: string;
  leadId: string;
  /** Optional callback when payment is initiated successfully (Razorpay popup launched). */
  onBooked?: () => void;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString()} → ${e.toLocaleDateString()}`;
}

export function BookTourCard({ customerId, leadId, onBooked }: BookTourCardProps) {
  const { toast } = useToast();

  const [tours, setTours] = React.useState<Tour[]>([]);
  const [loadingTours, setLoadingTours] = React.useState(true);
  const [selectedTourId, setSelectedTourId] = React.useState("");
  const [seats, setSeats] = React.useState("1");
  const [amountInr, setAmountInr] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    async function fetchTours() {
      try {
        const res = await fetch("/api/tours?status=ACTIVE&limit=100");
        if (!res.ok) throw new Error("fetch failed");
        const data = (await res.json()) as ToursListResponse;
        if (cancelled) return;
        setTours(data.tours ?? []);
      } catch {
        if (!cancelled) toast("error", "Failed to load tour inventory");
      } finally {
        if (!cancelled) setLoadingTours(false);
      }
    }
    fetchTours();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const seatsNum = Number.parseInt(seats, 10);
  const amountInrNum = Number.parseFloat(amountInr);
  const amountPaise =
    Number.isFinite(amountInrNum) && amountInrNum > 0
      ? Math.round(amountInrNum * 100)
      : 0;

  const selectedTour = tours.find((t) => t.id === selectedTourId) ?? null;
  const seatsAvailable = selectedTour ? selectedTour.capacity - selectedTour.sold : 0;
  const seatsValid = Number.isInteger(seatsNum) && seatsNum > 0;
  const seatsExceedCapacity = selectedTour ? seatsNum > seatsAvailable : false;
  const ready = !!selectedTour && seatsValid && !seatsExceedCapacity && amountPaise > 0;

  function handlePaymentLaunched() {
    toast("success", "Payment window opened — complete it to confirm the booking.");
    onBooked?.();
  }

  function handlePaymentError(msg: string) {
    toast("error", msg);
  }

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-gray-500" />
          <span>Book a tour</span>
        </div>
      }
    >
      {loadingTours ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : tours.length === 0 ? (
        <p className="py-2 text-xs text-gray-500">
          No active tours in inventory. Add tours via Settings → Tours.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Tour</label>
            <select
              value={selectedTourId}
              onChange={(e) => setSelectedTourId(e.target.value)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
            >
              <option value="">— Pick a tour —</option>
              {tours.map((t) => {
                const remaining = t.capacity - t.sold;
                return (
                  <option key={t.id} value={t.id} disabled={remaining <= 0}>
                    {t.code} · {t.name} ({formatDateRange(t.startDate, t.endDate)}) — {remaining} seat{remaining === 1 ? "" : "s"} left
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Seats"
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
            <Input
              label="Amount (INR)"
              type="number"
              min={1}
              step="0.01"
              value={amountInr}
              onChange={(e) => setAmountInr(e.target.value)}
              placeholder="e.g. 25000"
            />
          </div>

          {selectedTour && seatsExceedCapacity && (
            <p className="text-xs text-red-600">
              Only {seatsAvailable} seat{seatsAvailable === 1 ? "" : "s"} left on this tour — reduce seats or pick another.
            </p>
          )}

          <div className="pt-1">
            {ready ? (
              <TakePaymentButton
                customerId={customerId}
                leadId={leadId}
                tourId={selectedTour!.id}
                seats={seatsNum}
                amountPaise={amountPaise}
                label={`Take payment ₹${amountInrNum.toLocaleString("en-IN")}`}
                onSuccess={handlePaymentLaunched}
                onError={handlePaymentError}
              />
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500"
              >
                Pick a tour, seats, and amount
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
