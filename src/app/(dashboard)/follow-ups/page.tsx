"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  UserPlus,
  XCircle,
  Search,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface FollowUp {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  completedAt: string | null;
  messageTemplate: string | null;
  lead: {
    id: string;
    customer: { id: string; name: string; mobile: string };
    department: { id: string; name: string; color: string | null };
  };
  assignee: { id: string; name: string; avatarUrl: string | null };
}

interface Agent {
  id: string;
  name: string;
}

interface SuggestedFollowUp {
  id: string;
  leadId: string;
  leadName: string;
  bestTime: string;
  draftMessage: string;
  confidence: number;
  type: string;
  assigneeId?: string;
}

const typeLabels: Record<string, string> = {
  REMINDER: "Reminder",
  QUOTATION: "Quotation",
  DOCUMENT: "Document",
  PAYMENT: "Payment",
  RE_ENGAGE: "Re-engage",
};

const typeVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  REMINDER: "info",
  QUOTATION: "primary",
  DOCUMENT: "default",
  PAYMENT: "warning",
  RE_ENGAGE: "danger",
};

const statusVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  PENDING: "warning",
  SENT: "info",
  COMPLETED: "success",
  CANCELLED: "default",
};

function getUrgency(scheduledAt: string, status: string): "overdue" | "today" | "upcoming" | "done" {
  if (status === "COMPLETED" || status === "CANCELLED") return "done";
  const now = new Date();
  const scheduled = new Date(scheduledAt);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  if (scheduled < todayStart) return "overdue";
  if (scheduled < todayEnd) return "today";
  return "upcoming";
}

export default function FollowUpsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [followUps, setFollowUps] = React.useState<FollowUp[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);

  // Filters
  const [filterType, setFilterType] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("");
  const [filterAgent, setFilterAgent] = React.useState("");
  const [agents, setAgents] = React.useState<Agent[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = React.useState("queue");

  // Suggested follow-ups
  const [suggestions, setSuggestions] = React.useState<SuggestedFollowUp[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = React.useState(false);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);

  // Action modals
  const [snoozeTarget, setSnoozeTarget] = React.useState<FollowUp | null>(null);
  const [snoozeDate, setSnoozeDate] = React.useState("");
  const [reassignTarget, setReassignTarget] = React.useState<FollowUp | null>(null);
  const [reassignTo, setReassignTo] = React.useState("");
  const [actionLoading, setActionLoading] = React.useState(false);

  // Fetch agents
  React.useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch("/api/auth/users?role=AGENT&role=DEPT_MANAGER&role=COMPANY_ADMIN");
        if (res.ok) {
          const data = await res.json();
          setAgents(data.users || []);
        }
      } catch {
        // not critical
      }
    }
    fetchAgents();
  }, []);

  // Fetch follow-ups
  const fetchFollowUps = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (filterType) params.set("type", filterType);
      if (filterStatus) params.set("status", filterStatus);
      if (filterAgent) params.set("assignedTo", filterAgent);

      const res = await fetch(`/api/follow-ups?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setFollowUps(data.followUps);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load follow-ups");
    } finally {
      setLoading(false);
    }
  }, [page, filterType, filterStatus, filterAgent, toast]);

  React.useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  // Fetch suggested follow-ups when switching to that tab
  const fetchSuggestions = React.useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const res = await fetch("/api/follow-ups/suggestions");
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  React.useEffect(() => {
    if (activeTab === "suggested") {
      fetchSuggestions();
    }
  }, [activeTab, fetchSuggestions]);

  // Approve a suggestion -> create a real follow-up
  async function handleApproveSuggestion(suggestion: SuggestedFollowUp) {
    setApprovingId(suggestion.id);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: suggestion.leadId,
          assignedTo: suggestion.assigneeId || agents[0]?.id,
          type: suggestion.type || "REMINDER",
          scheduledAt: suggestion.bestTime,
          messageTemplate: suggestion.draftMessage,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create follow-up");
      }
      toast("success", `Follow-up approved for ${suggestion.leadName}`);
      // Remove from suggestions
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
      // Refresh the queue too
      fetchFollowUps();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setApprovingId(null);
    }
  }

  // Actions
  async function handleComplete(id: string) {
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", "Follow-up marked complete");
      fetchFollowUps();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleSnooze() {
    if (!snoozeTarget || !snoozeDate) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/follow-ups/${snoozeTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snooze", scheduledAt: snoozeDate }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", "Follow-up snoozed");
      setSnoozeTarget(null);
      setSnoozeDate("");
      fetchFollowUps();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReassign() {
    if (!reassignTarget || !reassignTo) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/follow-ups/${reassignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", assignedTo: reassignTo }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", "Follow-up reassigned");
      setReassignTarget(null);
      setReassignTo("");
      fetchFollowUps();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel this follow-up?")) return;
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast("success", "Follow-up cancelled");
      fetchFollowUps();
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

  // Sort by urgency client-side: overdue first, then today, then upcoming, then done
  const urgencyOrder = { overdue: 0, today: 1, upcoming: 2, done: 3 };
  const sortedFollowUps = [...followUps].sort((a, b) => {
    const ua = getUrgency(a.scheduledAt, a.status);
    const ub = getUrgency(b.scheduledAt, b.status);
    if (urgencyOrder[ua] !== urgencyOrder[ub]) return urgencyOrder[ua] - urgencyOrder[ub];
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  const typeOptions = [
    { label: "All Types", value: "" },
    { label: "Reminder", value: "REMINDER" },
    { label: "Quotation", value: "QUOTATION" },
    { label: "Document", value: "DOCUMENT" },
    { label: "Payment", value: "PAYMENT" },
    { label: "Re-engage", value: "RE_ENGAGE" },
  ];

  const statusOptions = [
    { label: "All Statuses", value: "" },
    { label: "Pending", value: "PENDING" },
    { label: "Sent", value: "SENT" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Cancelled", value: "CANCELLED" },
  ];

  const agentOptions = [
    { label: "All Agents", value: "" },
    ...agents.map((a) => ({ label: a.name, value: a.id })),
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Follow-ups" subtitle={`${total} total follow-ups`} />

      {/* Tabs: Queue vs Suggested */}
      <Tabs
        tabs={[
          { label: "Queue", value: "queue" },
          { label: `Suggested${suggestions.length > 0 ? ` (${suggestions.length})` : ""}`, value: "suggested" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "suggested" ? (
        /* Suggested follow-ups tab */
        loadingSuggestions ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-500">
            <Sparkles className="mb-2 h-10 w-10 text-gray-300" />
            <p className="text-sm">No AI suggestions right now</p>
            <p className="mt-1 text-xs text-gray-400">Suggestions are generated based on lead scoring and activity patterns</p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{s.leadName}</span>
                      <span
                        className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
                        title="AI confidence score"
                      >
                        {s.confidence}% confidence
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Clock className="h-3.5 w-3.5" />
                      Best time: {formatDateTime(s.bestTime)}
                    </div>
                    <p className="line-clamp-2 text-sm text-gray-600">
                      {s.draftMessage}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleApproveSuggestion(s)}
                    loading={approvingId === s.id}
                    disabled={approvingId !== null}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Queue tab content */
        <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

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
          value={filterAgent}
          onChange={(e) => { setFilterAgent(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {agentOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : sortedFollowUps.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-gray-500">
          <Clock className="mb-2 h-10 w-10 text-gray-300" />
          <p className="text-sm">No follow-ups found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead / Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFollowUps.map((fu) => {
                const urgency = getUrgency(fu.scheduledAt, fu.status);
                return (
                  <TableRow
                    key={fu.id}
                    className={
                      urgency === "overdue"
                        ? "bg-red-50/50"
                        : urgency === "today"
                        ? "bg-yellow-50/50"
                        : ""
                    }
                  >
                    <TableCell>
                      <button
                        onClick={() => router.push(`/leads/${fu.lead.id}`)}
                        className="text-left hover:underline"
                      >
                        <div className="font-medium text-gray-900">
                          {fu.lead.customer.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {fu.lead.customer.mobile}
                        </div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={typeVariant[fu.type] || "default"} size="sm">
                        {typeLabels[fu.type] || fu.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDateTime(fu.scheduledAt)}</div>
                      {urgency === "overdue" && (
                        <span className="flex items-center gap-1 text-xs text-red-600">
                          <AlertTriangle className="h-3 w-3" /> Overdue
                        </span>
                      )}
                      {urgency === "today" && (
                        <span className="text-xs text-yellow-600">Due today</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar name={fu.assignee.name} imageUrl={fu.assignee.avatarUrl || undefined} size="sm" />
                        <span className="text-sm">{fu.assignee.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[fu.status] || "default"} size="sm">
                        {fu.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(fu.status === "PENDING" || fu.status === "SENT") && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleComplete(fu.id)}
                            title="Mark complete"
                            className="rounded p-1 text-green-600 hover:bg-green-50"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setSnoozeTarget(fu);
                              // Default snooze to tomorrow same time
                              const d = new Date(fu.scheduledAt);
                              d.setDate(d.getDate() + 1);
                              setSnoozeDate(d.toISOString().slice(0, 16));
                            }}
                            title="Snooze"
                            className="rounded p-1 text-yellow-600 hover:bg-yellow-50"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setReassignTarget(fu);
                              setReassignTo("");
                            }}
                            title="Reassign"
                            className="rounded p-1 text-blue-600 hover:bg-blue-50"
                          >
                            <UserPlus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleCancel(fu.id)}
                            title="Cancel"
                            className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-red-500"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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

      </>
      )}

      {/* Snooze Modal */}
      <Modal
        open={!!snoozeTarget}
        onClose={() => setSnoozeTarget(null)}
        title="Snooze Follow-up"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Reschedule follow-up for{" "}
            <strong>{snoozeTarget?.lead.customer.name}</strong>
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              New Date & Time
            </label>
            <input
              type="datetime-local"
              value={snoozeDate}
              onChange={(e) => setSnoozeDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSnoozeTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSnooze}
              loading={actionLoading}
              disabled={!snoozeDate}
            >
              Snooze
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reassign Modal */}
      <Modal
        open={!!reassignTarget}
        onClose={() => setReassignTarget(null)}
        title="Reassign Follow-up"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Reassign follow-up for{" "}
            <strong>{reassignTarget?.lead.customer.name}</strong>
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              New Agent
            </label>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              <option value="">Select agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReassignTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleReassign}
              loading={actionLoading}
              disabled={!reassignTo}
            >
              Reassign
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
