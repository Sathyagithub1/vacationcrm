"use client";

import * as React from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Search, Filter } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface AuditUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: AuditUser | null;
}

const ENTITY_TYPES = [
  { label: "All Types", value: "" },
  { label: "User", value: "User" },
  { label: "Lead", value: "Lead" },
  { label: "Customer", value: "Customer" },
  { label: "Department", value: "Department" },
  { label: "FileUpload", value: "FileUpload" },
  { label: "Conversation", value: "Conversation" },
  { label: "FollowUp", value: "FollowUp" },
  { label: "Callback", value: "Callback" },
  { label: "Escalation", value: "Escalation" },
  { label: "Broadcast", value: "Broadcast" },
  { label: "Tenant", value: "Tenant" },
  { label: "PipelineStage", value: "PipelineStage" },
];

const actionVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  create: "success",
  update: "info",
  delete: "danger",
  login: "primary",
  lockout: "danger",
  upload: "success",
  assign: "warning",
};

function getActionVariant(action: string): "default" | "info" | "warning" | "success" | "danger" | "primary" {
  const key = Object.keys(actionVariant).find((k) => action.toLowerCase().includes(k));
  return key ? actionVariant[key] : "default";
}

export default function AuditLogPage() {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);

  // Filters
  const [actionFilter, setActionFilter] = React.useState("");
  const [entityTypeFilter, setEntityTypeFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // Users for dropdown
  const [users, setUsers] = React.useState<{ id: string; name: string }[]>([]);
  const [userFilter, setUserFilter] = React.useState("");

  // Expanded rows
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  // Fetch users for filter dropdown
  React.useEffect(() => {
    fetch("/api/users")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.users) {
          setUsers(data.users.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
        }
      })
      .catch(() => {});
  }, []);

  const fetchEntries = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "25");
      if (userFilter) params.set("userId", userFilter);
      if (actionFilter) params.set("action", actionFilter);
      if (entityTypeFilter) params.set("entityType", entityTypeFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/audit-log?${params.toString()}`);
      if (res.status === 403) {
        setEntries([]);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setEntries(data.entries || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [page, userFilter, actionFilter, entityTypeFilter, dateFrom, dateTo]);

  React.useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleFilterReset() {
    setUserFilter("");
    setActionFilter("");
    setEntityTypeFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const userOptions = [
    { label: "All Users", value: "" },
    ...users.map((u) => ({ label: u.name, value: u.id })),
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Filter className="h-4 w-4" />
          Filters
        </div>

        <Select
          label="User"
          options={userOptions}
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
          className="w-44"
        />

        <div className="w-44">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Action</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              placeholder="e.g. lead.create"
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
        </div>

        <Select
          label="Entity Type"
          options={ENTITY_TYPES}
          value={entityTypeFilter}
          onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(1); }}
          className="w-40"
        />

        <div className="w-36">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <div className="w-36">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <Button variant="ghost" size="sm" onClick={handleFilterReset}>
          Reset
        </Button>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500">
        {total} audit log {total === 1 ? "entry" : "entries"} found
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-gray-400">
          <p className="text-sm">No audit log entries found.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-40">Timestamp</TableHead>
                <TableHead className="w-40">User</TableHead>
                <TableHead className="w-40">Action</TableHead>
                <TableHead className="w-32">Entity Type</TableHead>
                <TableHead>Entity ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const isExpanded = expandedRows.has(entry.id);
                const hasChanges = entry.oldValue || entry.newValue;

                return (
                  <React.Fragment key={entry.id}>
                    <TableRow
                      className={hasChanges ? "cursor-pointer" : ""}
                      onClick={() => hasChanges && toggleRow(entry.id)}
                    >
                      <TableCell>
                        {hasChanges && (
                          isExpanded
                            ? <ChevronDown className="h-4 w-4 text-gray-400" />
                            : <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-gray-500">
                        {format(new Date(entry.createdAt), "dd MMM yyyy HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        {entry.user ? (
                          <div className="flex items-center gap-2">
                            <Avatar
                              name={entry.user.name}
                              imageUrl={entry.user.avatarUrl || undefined}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-gray-700">
                                {entry.user.name}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">System</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionVariant(entry.action)} size="sm">
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">{entry.entityType}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-gray-400">
                          {entry.entityId.slice(0, 8)}...
                        </span>
                      </TableCell>
                    </TableRow>

                    {/* Expanded row: show JSON diff */}
                    {isExpanded && hasChanges && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-gray-50 p-0">
                          <div className="grid grid-cols-2 gap-4 p-4">
                            {entry.oldValue && (
                              <div>
                                <p className="mb-1 text-xs font-semibold text-red-600">Old Value</p>
                                <pre className="max-h-64 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-gray-700">
                                  {JSON.stringify(entry.oldValue, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.newValue && (
                              <div>
                                <p className="mb-1 text-xs font-semibold text-green-600">New Value</p>
                                <pre className="max-h-64 overflow-auto rounded border border-green-200 bg-green-50 p-2 text-xs text-gray-700">
                                  {JSON.stringify(entry.newValue, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                          {(entry.ipAddress || entry.userAgent) && (
                            <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
                              {entry.ipAddress && <span>IP: {entry.ipAddress}</span>}
                              {entry.ipAddress && entry.userAgent && <span> | </span>}
                              {entry.userAgent && <span>UA: {entry.userAgent}</span>}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
