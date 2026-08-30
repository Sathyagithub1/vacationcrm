"use client";

/**
 * /settings/tours — Tours list page.
 *
 * Shows all tours in a table with capacity bars.
 * Supports:
 *  - Status filter (ALL / ACTIVE / SOLD_OUT / ARCHIVED)
 *  - Navigate to detail/edit page
 *  - New tour button → inline creation form (department + dates + capacity)
 *  - Bulk CSV import (template download + per-row results)
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
import { Plus, ExternalLink, Upload, Download, CheckCircle2, XCircle } from "lucide-react";

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

interface Department {
  id: string;
  name: string;
}

interface ImportRow {
  code: string;
  name: string;
  description?: string;
  department?: string;
  startDate: string;
  endDate: string;
  capacity: string;
  status?: string;
}

interface ImportResult {
  row: number;
  code: string;
  ok: boolean;
  error?: string;
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

const CSV_HEADERS = ["code", "name", "description", "department", "startDate", "endDate", "capacity", "status"];

const CSV_TEMPLATE =
  CSV_HEADERS.join(",") +
  "\n" +
  "BALI-7D,Bali 7-Day Escape,Beaches and temples,Sales,2026-11-05,2026-11-11,20,ACTIVE\n" +
  "GOA-3D,Goa Weekend,Short getaway,Sales,2026-12-12,2026-12-14,30,ACTIVE\n";

/** Minimal CSV parser that handles quoted fields and escaped quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }

  if (rows.length < 1) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? "").trim(); });
    return obj;
  });
}

export default function ToursListPage() {
  const { toast } = useToast();

  const [loading,    setLoading]    = React.useState(true);
  const [tours,      setTours]      = React.useState<Tour[]>([]);
  const [total,      setTotal]      = React.useState(0);
  const [page,       setPage]       = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [departments, setDepartments] = React.useState<Department[]>([]);

  // New tour modal state
  const [showNew, setShowNew] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName,  setNewName]  = React.useState("");
  const [newCode,  setNewCode]  = React.useState("");
  const [newCap,   setNewCap]   = React.useState(20);
  const [newDept,  setNewDept]  = React.useState("");
  const [newStart, setNewStart] = React.useState("");
  const [newEnd,   setNewEnd]   = React.useState("");

  // Import modal state
  const [showImport, setShowImport] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importRows, setImportRows] = React.useState<ImportRow[]>([]);
  const [importResults, setImportResults] = React.useState<{ created: number; failed: number; total: number; results: ImportResult[] } | null>(null);
  const [parseError, setParseError] = React.useState("");

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

  const fetchDepartments = React.useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (res.ok) {
        const json = await res.json();
        setDepartments(json.departments || []);
      }
    } catch {
      // non-fatal
    }
  }, []);

  React.useEffect(() => {
    fetchTours(1, statusFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  React.useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  async function handleCreate() {
    if (!newName.trim() || !newCode.trim()) {
      toast("error", "Name and code are required");
      return;
    }
    if (!newDept) {
      toast("error", "Please choose a department");
      return;
    }
    if (!newStart || !newEnd) {
      toast("error", "Start and end dates are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/tours", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name: newName.trim(),
          code: newCode.trim(),
          capacity: newCap,
          departmentId: newDept,
          startDate: newStart,
          endDate: newEnd,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to create tour");
      }
      toast("success", `Tour "${newName.trim()}" created`);
      setShowNew(false);
      setNewName(""); setNewCode(""); setNewCap(20); setNewDept(""); setNewStart(""); setNewEnd("");
      fetchTours(1, statusFilter);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create tour");
    } finally {
      setCreating(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tours-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function ingestCsvText(text: string) {
    setImportResults(null);
    setParseError("");
    try {
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        setParseError("No data rows found. Include a header row plus at least one tour.");
        setImportRows([]);
        return;
      }
      const missing = ["code", "name", "startDate", "endDate", "capacity"].filter(
        (h) => !(h in parsed[0]),
      );
      if (missing.length > 0) {
        setParseError(`Missing required column(s): ${missing.join(", ")}`);
        setImportRows([]);
        return;
      }
      setImportRows(parsed as unknown as ImportRow[]);
    } catch {
      setParseError("Could not parse the CSV. Check the format against the template.");
      setImportRows([]);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => ingestCsvText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function submitImport() {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportResults(null);
    try {
      const res = await fetch("/api/tours/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tours: importRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResults(data);
      if (data.created > 0) {
        toast("success", `Imported ${data.created} tour${data.created === 1 ? "" : "s"}`);
        fetchTours(1, statusFilter);
      }
      if (data.failed > 0) {
        toast("warning", `${data.failed} row${data.failed === 1 ? "" : "s"} failed — see details`);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function resetImport() {
    setShowImport(false);
    setImportRows([]);
    setImportResults(null);
    setParseError("");
  }

  const deptSelectOptions = [
    { value: "", label: departments.length ? "Select department…" : "No departments — create one first" },
    ...departments.map((d) => ({ value: d.id, label: d.name })),
  ];

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
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { resetImport(); setShowImport(true); }}>
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" />
            New Tour
          </Button>
        </div>
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
            <p className="mt-1 text-xs text-gray-500">Create a tour package or import a CSV to get started.</p>
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
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Department</label>
            <Select
              options={deptSelectOptions}
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Date"
              type="date"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
            />
          </div>
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

      {/* Import CSV Modal */}
      <Modal open={showImport} onClose={resetImport} title="Import Tours from CSV">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-600">
              Upload a CSV with columns:{" "}
              <code className="rounded bg-white px-1 py-0.5 text-[11px]">{CSV_HEADERS.join(", ")}</code>.
              Department matches by name; <code className="rounded bg-white px-1 py-0.5 text-[11px]">status</code> and{" "}
              <code className="rounded bg-white px-1 py-0.5 text-[11px]">description</code> are optional.
            </p>
            <Button variant="ghost" size="sm" onClick={downloadTemplate} className="shrink-0">
              <Download className="h-4 w-4" />
              Template
            </Button>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">CSV file</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-600 hover:file:bg-primary-100"
            />
          </div>

          {parseError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {parseError}
            </div>
          )}

          {importRows.length > 0 && !importResults && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Parsed <strong>{importRows.length}</strong> row{importRows.length === 1 ? "" : "s"} ready to import.
            </div>
          )}

          {importResults && (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="font-medium text-emerald-600">{importResults.created} created</span>
                {importResults.failed > 0 && (
                  <span className="font-medium text-red-600">{importResults.failed} failed</span>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200">
                {importResults.results.map((r) => (
                  <div
                    key={r.row}
                    className="flex items-start gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-0"
                  >
                    {r.ok ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    <span className="font-mono text-gray-500">Row {r.row}</span>
                    <span className="font-mono text-gray-700">{r.code || "—"}</span>
                    {r.error && <span className="text-red-600">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={resetImport}>
              {importResults ? "Close" : "Cancel"}
            </Button>
            {!importResults && (
              <Button onClick={submitImport} loading={importing} disabled={importRows.length === 0}>
                Import {importRows.length > 0 ? `${importRows.length} tour${importRows.length === 1 ? "" : "s"}` : ""}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
