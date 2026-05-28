"use client";

/**
 * /settings/tours — Tours list page.
 *
 * Shows all tours in a table with capacity bars.
 * Supports:
 *  - Status filter (ALL / ACTIVE / SOLD_OUT / ARCHIVED)
 *  - Navigate to detail/edit page
 *  - New tour button → inline creation form
 *
 * Accessible to COMPANY_ADMIN / DEPT_MANAGER.
 */

import * as React from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { TourCapacityBar } from "@/components/intake/TourCapacityBar";
import { Plus, ExternalLink } from "lucide-react";

interface Tour {
  id: string;
  name: string;
  code: string;
  capacity: number;
  bookedCount: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  departmentId: string | null;
}

interface ApiResponse {
  tours: Tour[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { value: "",         label: "All statuses" },
  { value: "ACTIVE",   label: "Active"       },
  { value: "SOLD_OUT", label: "Sold Out"      },
  { value: "ARCHIVED", label: "Archived"      },
];

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "danger" | "default" }> = {
  ACTIVE:   { label: "Active",    variant: "success" },
  SOLD_OUT: { label: "Sold Out",  variant: "danger"  },
  ARCHIVED: { label: "Archived",  variant: "default" },
};

const PAGE_SIZE = 20;

export default function ToursListPage() {
  const { toast } = useToast();

  const [loading,    setLoading]    = React.useState(true);
  const [tours,      setTours]      = React.useState<Tour[]>([]);
  const [total,      setTotal]      = React.useState(0);
  const [page,       setPage]       = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("");

  // New tour modal state
  const [showNew, setShowNew] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName,  setNewName]  = React.useState("");
  const [newCode,  setNewCode]  = React.useState("");
  const [newCap,   setNewCap]   = React.useState(20);

  async function fetchTours(p: number, status: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:  String(p),
        limit: String(PAGE_SIZE),
      });
      if (status) params.set("status", status);

      const res = await fetch(`/api/tours?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load tours");
      const data: ApiResponse = await res.json();
      setTours(data.tours);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load tours");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchTours(1, statusFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleCreate() {
    if (!newName.trim() || !newCode.trim()) {
      toast("error", "Name and code are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/tours", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName.trim(), code: newCode.trim(), capacity: newCap }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to create tour");
      }
      toast("success", `Tour "${newName.trim()}" created`);
      setShowNew(false);
      setNewName(""); setNewCode(""); setNewCap(20);
      fetchTours(1, statusFilter);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create tour");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Tours</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Manage tour packages and their booking capacity.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" />
          New Tour
        </Button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        />
        {!loading && (
          <span className="text-xs text-gray-400">
            {total} tour{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : tours.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-gray-900">No tours found</p>
            <p className="mt-1 text-xs text-gray-500">Create a tour package to get started.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tours.map((tour) => {
                const badge = STATUS_BADGE[tour.status] ?? { label: tour.status, variant: "default" as const };
                return (
                  <TableRow key={tour.id}>
                    <TableCell className="font-medium text-gray-900">{tour.name}</TableCell>
                    <TableCell className="font-mono text-xs">{tour.code}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {tour.startDate
                        ? `${new Date(tour.startDate).toLocaleDateString()} – ${tour.endDate ? new Date(tour.endDate).toLocaleDateString() : "?"}`
                        : "—"}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <TourCapacityBar
                        booked={tour.bookedCount}
                        capacity={tour.capacity}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/settings/tours/${tour.id}`}>
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={(p) => fetchTours(p, statusFilter)}
          />
        </div>
      )}

      {/* New Tour Modal */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New Tour"
      >
        <div className="space-y-4">
          <Input
            label="Tour Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Bali Family Package 7D"
          />
          <Input
            label="Tour Code (unique)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="e.g. BALI-7D-FAM"
          />
          <Input
            label="Capacity (seats)"
            type="number"
            min={1}
            value={newCap}
            onChange={(e) => setNewCap(Math.max(1, Number(e.target.value)))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              Create Tour
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
