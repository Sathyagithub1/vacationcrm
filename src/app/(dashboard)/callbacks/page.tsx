"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface Callback {
  id: string;
  preferredTime: string;
  status: string;
  notes: string | null;
  lead: {
    id: string;
    customer: { id: string; name: string; mobile: string; email: string | null };
  };
  department: { id: string; name: string; color: string | null };
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

interface Department {
  id: string;
  name: string;
}

const statusVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  SCHEDULED: "warning",
  COMPLETED: "success",
  MISSED: "danger",
};

const statusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  MISSED: "Missed",
};

export default function CallbacksPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [callbacks, setCallbacks] = React.useState<Callback[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);

  // Filters
  const [filterStatus, setFilterStatus] = React.useState("");
  const [filterDept, setFilterDept] = React.useState("");
  const [departments, setDepartments] = React.useState<Department[]>([]);

  // Fetch departments
  React.useEffect(() => {
    async function fetchDepts() {
      try {
        const res = await fetch("/api/departments");
        if (res.ok) {
          const data = await res.json();
          setDepartments(data.departments || []);
        }
      } catch {
        // not critical
      }
    }
    fetchDepts();
  }, []);

  // Fetch callbacks
  const fetchCallbacks = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (filterStatus) params.set("status", filterStatus);
      if (filterDept) params.set("departmentId", filterDept);

      const res = await fetch(`/api/callbacks?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setCallbacks(data.callbacks);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load callbacks");
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterDept, toast]);

  React.useEffect(() => {
    fetchCallbacks();
  }, [fetchCallbacks]);

  // Actions
  async function handleAction(id: string, action: "complete" | "missed") {
    try {
      const res = await fetch(`/api/callbacks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", action === "complete" ? "Callback marked complete" : "Callback marked missed");
      fetchCallbacks();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    }
  }

  function formatDateTime(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function isPast(dateStr: string) {
    return new Date(dateStr) < new Date();
  }

  const statusOptions = [
    { label: "All Statuses", value: "" },
    { label: "Scheduled", value: "SCHEDULED" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Missed", value: "MISSED" },
  ];

  const deptOptions = [
    { label: "All Departments", value: "" },
    ...departments.map((d) => ({ label: d.name, value: d.id })),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Callbacks" subtitle={`${total} total callbacks`} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterDept}
          onChange={(e) => { setFilterDept(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {deptOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : callbacks.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-gray-500">
          <Phone className="mb-2 h-10 w-10 text-gray-300" />
          <p className="text-sm">No callbacks found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Preferred Time</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callbacks.map((cb) => (
                <TableRow
                  key={cb.id}
                  className={
                    cb.status === "SCHEDULED" && isPast(cb.preferredTime)
                      ? "bg-red-50/50"
                      : ""
                  }
                >
                  <TableCell>
                    <button
                      onClick={() => router.push(`/leads/${cb.lead.id}`)}
                      className="text-left hover:underline"
                    >
                      <div className="font-medium text-gray-900">
                        {cb.lead.customer.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {cb.lead.customer.mobile}
                      </div>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge
                      size="sm"
                      style={
                        cb.department.color
                          ? { backgroundColor: `${cb.department.color}20`, color: cb.department.color }
                          : undefined
                      }
                    >
                      {cb.department.name}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{formatDateTime(cb.preferredTime)}</div>
                    {cb.status === "SCHEDULED" && isPast(cb.preferredTime) && (
                      <span className="text-xs text-red-600">Overdue</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {cb.assignee ? (
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={cb.assignee.name}
                          imageUrl={cb.assignee.avatarUrl || undefined}
                          size="sm"
                        />
                        <span className="text-sm">{cb.assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-gray-600 line-clamp-2">
                      {cb.notes || "--"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[cb.status] || "default"} size="sm">
                      {statusLabels[cb.status] || cb.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {cb.status === "SCHEDULED" && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleAction(cb.id, "complete")}
                          title="Mark complete"
                          className="rounded p-1 text-green-600 hover:bg-green-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleAction(cb.id, "missed")}
                          title="Mark missed"
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * 20 + 1}--{Math.min(page * 20, total)} of {total}
              </p>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
