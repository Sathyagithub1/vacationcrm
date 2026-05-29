"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Plus, Search, LayoutList, Columns3 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { LeadTable, type LeadRow } from "@/components/leads/lead-table";
import { LeadForm } from "@/components/leads/lead-form";
import { PipelineBoard } from "@/components/leads/pipeline-board";
import type { LeadCardData } from "@/components/leads/lead-card";
import { cn } from "@/lib/utils";
import { SCORE_TIER_OPTIONS, getScoreTier } from "@/components/leads/score-badge";

interface Department {
  id: string;
  name: string;
  color: string | null;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface Agent {
  id: string;
  name: string;
}

export default function LeadsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;
  const currentUserRole = session?.user?.role ?? null;
  // Phase 6i — Agents default to "Assigned to me" so their first view shows
  // their own queue instead of every lead in the tenant. Managers/admins see
  // all by default and can toggle to "Me" with one click. Special sentinel
  // "__me__" survives URL serialization without leaking the user's UUID.
  const isAgent = currentUserRole === "AGENT";

  // View state
  const [viewMode, setViewMode] = React.useState<"table" | "board">("table");

  // Data state
  const [leads, setLeads] = React.useState<LeadRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);

  // Filter state
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [filterDept, setFilterDept] = React.useState("");
  const [filterStage, setFilterStage] = React.useState("");
  const [filterSource, setFilterSource] = React.useState("");
  const [filterPriority, setFilterPriority] = React.useState("");
  const [filterAssignee, setFilterAssignee] = React.useState<string>("");
  const [filterTier, setFilterTier] = React.useState("");
  const [sortByScore, setSortByScore] = React.useState<"asc" | "desc" | null>(null);

  // Initialize assignee filter to "Me" for agents the first time we know who
  // they are. Only fire once — leave their explicit choice alone afterwards.
  const initializedAssigneeRef = React.useRef(false);
  React.useEffect(() => {
    if (initializedAssigneeRef.current) return;
    if (!currentUserId) return;
    if (isAgent) setFilterAssignee("__me__");
    initializedAssigneeRef.current = true;
  }, [currentUserId, isAgent]);

  // Reference data
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Debounce search
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch reference data once
  React.useEffect(() => {
    async function fetchRefs() {
      try {
        const [deptRes, stageRes] = await Promise.all([
          fetch("/api/departments"),
          fetch("/api/pipeline-stages"),
        ]);

        if (deptRes.ok) {
          const deptData = await deptRes.json();
          setDepartments(deptData.departments || []);
        }
        if (stageRes.ok) {
          const stageData = await stageRes.json();
          setStages(stageData.stages || []);
        }

        // Fetch agents (users who can be assigned)
        // For now, we use a basic endpoint — will be enhanced with user management module
        try {
          const agentRes = await fetch("/api/auth/users?role=AGENT&role=DEPT_MANAGER&role=COMPANY_ADMIN");
          if (agentRes.ok) {
            const agentData = await agentRes.json();
            setAgents(agentData.users || []);
          }
        } catch {
          // Agent list not critical
        }
      } catch {
        toast("error", "Failed to load reference data");
      }
    }
    fetchRefs();
  }, [toast]);

  // Fetch leads
  const fetchLeads = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      params.set("page", String(page));
      params.set("limit", viewMode === "board" ? "200" : "20");
      if (filterDept) params.set("departmentId", filterDept);
      if (filterStage) params.set("stageId", filterStage);
      if (filterSource) params.set("source", filterSource);
      if (filterPriority) params.set("priority", filterPriority);
      // Phase 6i — assignedTo filter (resolve "__me__" sentinel here)
      if (filterAssignee === "__me__" && currentUserId) {
        params.set("assignedTo", currentUserId);
      } else if (filterAssignee === "__unassigned__") {
        params.set("assignedTo", "null");
      } else if (filterAssignee) {
        params.set("assignedTo", filterAssignee);
      }

      const res = await fetch(`/api/leads?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      // Fetch scores for all leads in parallel
      const leadsWithScores = await Promise.all(
        (data.leads as LeadRow[]).map(async (lead: LeadRow) => {
          try {
            const scoreRes = await fetch(`/api/leads/${lead.id}/score`);
            if (scoreRes.ok) {
              const scoreData = await scoreRes.json();
              return { ...lead, score: scoreData.score?.total ?? null };
            }
          } catch {
            // Score fetch non-critical
          }
          return { ...lead, score: null };
        })
      );

      setLeads(leadsWithScores);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, filterDept, filterStage, filterSource, filterPriority, filterAssignee, currentUserId, viewMode, toast]);

  React.useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Create lead handler
  async function handleCreateLead(formData: unknown) {
    setCreating(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create lead");
      }
      toast("success", "Lead created");
      setCreateModalOpen(false);
      fetchLeads();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setCreating(false);
    }
  }

  // Pipeline stage change handler (drag-and-drop)
  async function handleStageChange(leadId: string, newStageId: string) {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change-stage", stageId: newStageId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change stage");
      }
      toast("success", "Stage updated");
      fetchLeads();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to change stage");
    }
  }

  // Bulk selection
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  // Export CSV
  function handleExportCsv() {
    const selectedLeads = leads.filter((l) => selectedIds.has(l.id));
    const rows = [
      ["Customer Name", "Mobile", "Email", "Department", "Stage", "Priority", "Destination", "Travel Date", "Source", "Assigned To", "Created"],
      ...selectedLeads.map((l) => [
        l.customer.name,
        l.customer.mobile,
        l.customer.email || "",
        l.department.name,
        l.stage.name,
        l.priority,
        l.destination || "",
        l.travelDate ? new Date(l.travelDate).toISOString().split("T")[0] : "",
        l.source,
        l.assignee?.name || "",
        new Date(l.createdAt).toISOString().split("T")[0],
      ]),
    ];

    const csvContent = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("success", `Exported ${selectedLeads.length} leads`);
  }

  // Filter options
  const deptOptions = [{ label: "All Departments", value: "" }, ...departments.map((d) => ({ label: d.name, value: d.id }))];
  const stageOptions = [{ label: "All Stages", value: "" }, ...stages.map((s) => ({ label: s.name, value: s.id }))];
  const sourceOptions = [
    { label: "All Sources", value: "" },
    { label: "WhatsApp", value: "WHATSAPP" },
    { label: "Website", value: "WEBSITE" },
    { label: "Facebook", value: "FB" },
    { label: "Instagram", value: "IG" },
    { label: "Manual", value: "MANUAL" },
  ];
  const priorityOptions = [
    { label: "All Priorities", value: "" },
    { label: "Low", value: "LOW" },
    { label: "Medium", value: "MEDIUM" },
    { label: "High", value: "HIGH" },
    { label: "VIP", value: "VIP" },
  ];

  // Apply client-side tier filter and score sort
  const displayLeads = React.useMemo(() => {
    let result = [...leads];

    // Tier filter
    if (filterTier) {
      result = result.filter((l) => {
        if (l.score == null) return filterTier === "COLD"; // null scores treated as COLD
        return getScoreTier(l.score) === filterTier;
      });
    }

    // Score sort
    if (sortByScore) {
      result.sort((a, b) => {
        const sa = a.score ?? 0;
        const sb = b.score ?? 0;
        return sortByScore === "asc" ? sa - sb : sb - sa;
      });
    }

    return result;
  }, [leads, filterTier, sortByScore]);

  function handleSortByScore() {
    setSortByScore((prev) => {
      if (prev === null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  }

  // Convert leads to card data for pipeline board
  const boardLeads: (LeadCardData & { stageId: string })[] = leads.map((l) => ({
    id: l.id,
    stageId: l.stageId,
    destination: l.destination,
    travelDate: l.travelDate,
    priority: l.priority,
    source: l.source,
    customer: l.customer,
    department: l.department,
    assignee: l.assignee,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="Leads" subtitle={`${total} total leads`}>
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4" />
          New Lead
        </Button>
      </PageHeader>

      {/* Filters & view toggle bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, mobile, destination..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        {/* Filter dropdowns */}
        <select
          value={filterDept}
          onChange={(e) => { setFilterDept(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {deptOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterStage}
          onChange={(e) => { setFilterStage(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {stageOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterSource}
          onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterPriority}
          onChange={(e) => { setFilterPriority(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {priorityOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterAssignee}
          onChange={(e) => { setFilterAssignee(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          aria-label="Filter by assignee"
        >
          <option value="">All assignees</option>
          {currentUserId && <option value="__me__">Assigned to me</option>}
          <option value="__unassigned__">Unassigned</option>
          {agents
            .filter((a) => a.id !== currentUserId)
            .map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
        </select>

        <select
          value={filterTier}
          onChange={(e) => { setFilterTier(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          aria-label="Filter by lead score tier"
        >
          {SCORE_TIER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* View toggle */}
        <div className="ml-auto flex rounded-md border border-gray-300">
          <button
            onClick={() => setViewMode("table")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors",
              viewMode === "table"
                ? "bg-primary-50 text-primary-700"
                : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <LayoutList className="h-4 w-4" />
            Table
          </button>
          <button
            onClick={() => setViewMode("board")}
            className={cn(
              "flex items-center gap-1.5 border-l border-gray-300 px-3 py-1.5 text-sm transition-colors",
              viewMode === "board"
                ? "bg-primary-50 text-primary-700"
                : "text-gray-500 hover:bg-gray-50"
            )}
          >
            <Columns3 className="h-4 w-4" />
            Board
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : viewMode === "table" ? (
        <div className="rounded-lg border border-gray-200 bg-white">
          <LeadTable
            leads={displayLeads}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onExportCsv={handleExportCsv}
            showBulkActions
            sortByScore={sortByScore}
            onSortByScore={handleSortByScore}
          />

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
      ) : (
        <PipelineBoard
          stages={stages}
          leads={boardLeads}
          onStageChange={handleStageChange}
          onLeadClick={(id) => router.push(`/leads/${id}`)}
        />
      )}

      {/* Create Lead Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Lead"
      >
        <LeadForm
          departments={departments}
          agents={agents}
          onSubmit={handleCreateLead}
          onCancel={() => setCreateModalOpen(false)}
          loading={creating}
        />
      </Modal>
    </div>
  );
}
