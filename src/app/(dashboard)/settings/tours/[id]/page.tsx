"use client";

/**
 * /settings/tours/[id] — Tour detail/edit page.
 *
 * Two sections:
 *  1. Edit tour details (name, code, capacity, dates, status)
 *  2. Bookings sub-table (list + add + remove)
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { TourCapacityBar } from "@/components/intake/TourCapacityBar";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

interface TourDetail {
  id: string;
  name: string;
  code: string;
  capacity: number;
  bookedCount: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

interface Booking {
  id: string;
  leadId: string;
  leadName: string | null;
  seats: number;
  status: string;
  createdAt: string;
}

const TOUR_STATUS_OPTIONS = [
  { value: "ACTIVE",   label: "Active"   },
  { value: "SOLD_OUT", label: "Sold Out" },
  { value: "ARCHIVED", label: "Archived" },
];

const BOOKING_STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "default"> = {
  CONFIRMED: "success",
  PENDING:   "warning",
  CANCELLED: "danger",
};

export default function TourDetailPage() {
  const params    = useParams();
  const router    = useRouter();
  const { toast } = useToast();
  const id        = typeof params.id === "string" ? params.id : (params.id as string[])[0];

  const [loading,  setLoading]  = React.useState(true);
  const [saving,   setSaving]   = React.useState(false);
  const [tour,     setTour]     = React.useState<TourDetail | null>(null);
  const [bookings, setBookings] = React.useState<Booking[]>([]);

  // Edit state
  const [name,      setName]      = React.useState("");
  const [code,      setCode]      = React.useState("");
  const [capacity,  setCapacity]  = React.useState(20);
  const [status,    setStatus]    = React.useState("ACTIVE");
  const [startDate, setStartDate] = React.useState("");
  const [endDate,   setEndDate]   = React.useState("");
  const [description, setDescription] = React.useState("");

  // Delete booking state
  const [deletingBookingId, setDeletingBookingId] = React.useState<string | null>(null);

  // Add booking modal
  const [showAddBooking, setShowAddBooking] = React.useState(false);
  const [addingBooking,  setAddingBooking]  = React.useState(false);
  const [newLeadId,  setNewLeadId]  = React.useState("");
  const [newSeats,   setNewSeats]   = React.useState(1);

  async function loadTour() {
    setLoading(true);
    try {
      const [tourRes, bookRes] = await Promise.all([
        fetch(`/api/tours/${id}`),
        fetch(`/api/tours/${id}/bookings?limit=50`),
      ]);
      if (!tourRes.ok) throw new Error("Tour not found");
      const tourData: { tour: TourDetail } = await tourRes.json();
      setTour(tourData.tour);
      setName(tourData.tour.name);
      setCode(tourData.tour.code);
      setCapacity(tourData.tour.capacity);
      setStatus(tourData.tour.status);
      setStartDate(tourData.tour.startDate ? tourData.tour.startDate.slice(0, 10) : "");
      setEndDate(tourData.tour.endDate   ? tourData.tour.endDate.slice(0, 10)   : "");
      setDescription(tourData.tour.description ?? "");

      if (bookRes.ok) {
        const bookData: { bookings: Booking[] } = await bookRes.json();
        setBookings(bookData.bookings ?? []);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load tour");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadTour();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave() {
    if (!name.trim() || !code.trim()) {
      toast("error", "Name and code are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tours/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:        name.trim(),
          code:        code.trim(),
          capacity,
          status,
          startDate:   startDate || null,
          endDate:     endDate   || null,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save tour");
      }
      toast("success", "Tour updated");
      loadTour();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save tour");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBooking(bookingId: string) {
    setDeletingBookingId(bookingId);
    try {
      const res = await fetch(`/api/tours/${id}/bookings/${bookingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete booking");
      }
      toast("success", "Booking removed");
      loadTour();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete booking");
    } finally {
      setDeletingBookingId(null);
    }
  }

  async function handleAddBooking() {
    if (!newLeadId.trim()) {
      toast("error", "Lead ID is required");
      return;
    }
    setAddingBooking(true);
    try {
      const res = await fetch(`/api/tours/${id}/bookings`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ leadId: newLeadId.trim(), seats: newSeats }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to add booking");
      }
      toast("success", "Booking added");
      setShowAddBooking(false);
      setNewLeadId(""); setNewSeats(1);
      loadTour();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to add booking");
    } finally {
      setAddingBooking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!tour) {
    return <p className="py-12 text-center text-sm text-gray-500">Tour not found.</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/settings/tours")}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-900">{tour.name}</h2>
          <p className="mt-0.5 text-xs font-mono text-gray-500">{tour.code}</p>
        </div>
        <TourCapacityBar
          booked={tour.bookedCount}
          capacity={tour.capacity}
          className="w-40"
        />
      </div>

      {/* Edit section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Tour Details</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Tour Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Tour Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Capacity (seats)"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))}
          />
          <Select
            label="Status"
            options={TOUR_STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start Date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="End Date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional tour description"
            className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} loading={saving}>
            Save Changes
          </Button>
        </div>
      </div>

      {/* Bookings sub-table */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Bookings</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAddBooking(true)}
          >
            <Plus className="h-4 w-4" />
            Add Booking
          </Button>
        </div>

        {bookings.length === 0 ? (
          <p className="text-sm text-gray-400">No bookings yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Booked At</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-xs font-mono">
                    {b.leadName ?? b.leadId}
                  </TableCell>
                  <TableCell>{b.seats}</TableCell>
                  <TableCell>
                    <Badge variant={BOOKING_STATUS_BADGE[b.status] ?? "default"}>
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      onClick={() => handleDeleteBooking(b.id)}
                      disabled={deletingBookingId === b.id}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Remove booking"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add booking modal */}
      <Modal
        open={showAddBooking}
        onClose={() => setShowAddBooking(false)}
        title="Add Booking"
      >
        <div className="space-y-4">
          <Input
            label="Lead ID"
            value={newLeadId}
            onChange={(e) => setNewLeadId(e.target.value)}
            placeholder="Paste lead UUID"
          />
          <Input
            label="Number of seats"
            type="number"
            min={1}
            value={newSeats}
            onChange={(e) => setNewSeats(Math.max(1, Number(e.target.value)))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAddBooking(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddBooking} loading={addingBooking}>
              Add Booking
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
