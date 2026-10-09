"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, Send, Trash2, X, Calendar, History, ChevronDown, ChevronUp, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/loading";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ActivityTimeline, type Activity } from "@/components/leads/activity-timeline";
import { LeadDetailPanel } from "@/components/leads/lead-detail-panel";
import { AiInsightsPanel } from "@/components/leads/ai-insights-panel";
import { BookTourCard } from "@/components/leads/book-tour-card";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  mobile: string;
  alternatePhone: string | null;
  address: string | null;
}

interface Lead {
  id: string;
  destination: string | null;
  travelDate: string | null;
  numPassengers: number | null;
  specialRequirement: string | null;
  source: string;
  priority: string;
  isFutureInterest: boolean;
  createdAt: string;
  customer: Customer;
  department: { id: string; name: string; color: string | null; slug: string };
  stage: { id: string; name: string; color: string | null; position: number };
  assignee: { id: string; name: string; avatarUrl: string | null; email: string } | null;
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

// ── Customer History types (from /api/customers/[id] and /api/payments) ──────
interface HistoryLead {
  id: string;
  destination: string | null;
  createdAt: string;
  stage: { id: string; name: string; color: string | null };
  department: { id: string; name: string; color: string | null };
}

interface HistoryPayment {
  id: string;
  amountPaise: number;
  currency: string;
  status: string;
  createdAt: string;
  tour: { id: string; code: string; name: string } | null;
  lead: { id: string; destination: string | null } | null;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// Map lead stage names to the shared Badge variants (mirrors the customers page).
const historyStageColorMap: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  new: "info",
  contacted: "primary",
  qualified: "warning",
  converted: "success",
  lost: "danger",
};

function historyStageVariant(stageName: string): "default" | "info" | "warning" | "success" | "danger" | "primary" {
  const lower = stageName.toLowerCase();
  for (const [key, variant] of Object.entries(historyStageColorMap)) {
    if (lower.includes(key)) return variant;
  }
  return "default";
}

// Map Razorpay-style payment statuses to Badge variants.
function paymentStatusVariant(status: string): "default" | "info" | "warning" | "success" | "danger" | "primary" {
  switch (status) {
    case "CAPTURED":
      return "success";
    case "REFUNDED":
    case "FAILED":
      return "danger";
    case "REFUND_PENDING":
      return "warning";
    case "CREATED":
    case "AUTHORIZED":
      return "info";
    default:
      return "default";
  }
}

function formatHistoryDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const leadId = params.id as string;

  const [lead, setLead] = React.useState<Lead | null>(null);
  const [activities, setActivities] = React.useState<Activity[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [stages, setStages] = React.useState<Stage[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);

  // Customer History (this customer's OTHER leads + their past payments)
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyLoaded, setHistoryLoaded] = React.useState(false);
  const [historyLeads, setHistoryLeads] = React.useState<HistoryLead[]>([]);
  const [historyPayments, setHistoryPayments] = React.useState<HistoryPayment[]>([]);
  const [historyPaymentsAvailable, setHistoryPaymentsAvailable] = React.useState(true);

  // Note form
  const [noteText, setNoteText] = React.useState("");
  const [addingNote, setAddingNote] = React.useState(false);

  // Action states
  const [changingStage, setChangingStage] = React.useState(false);
  const [assigningAgent, setAssigningAgent] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Modal states for quick actions
  const [callbackModal, setCallbackModal] = React.useState(false);
  const [followUpModal, setFollowUpModal] = React.useState(false);
  const [escalateModal, setEscalateModal] = React.useState(false);

  // Callback form
  const [callbackTime, setCallbackTime] = React.useState("");
  const [callbackNotes, setCallbackNotes] = React.useState("");
  const [submittingCallback, setSubmittingCallback] = React.useState(false);

  // Follow-up form
  const [followUpType, setFollowUpType] = React.useState("REMINDER");
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [submittingFollowUp, setSubmittingFollowUp] = React.useState(false);

  // Escalation form
  const [escalationReason, setEscalationReason] = React.useState("COMPLEX_REQUEST");
  const [escalationNotes, setEscalationNotes] = React.useState("");
  const [escalationTo, setEscalationTo] = React.useState("");
  const [submittingEscalation, setSubmittingEscalation] = React.useState(false);

  // Fetch lead detail
  const fetchLead = React.useCallback(
    () =>
      fetch(`/api/leads/${leadId}`)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) {
              toast("error", "Lead not found");
              router.push("/leads");
              return null;
            }
            throw new Error("Failed to fetch");
          }
          return res.json();
        })
        .then((data) => {
          if (!data) return;
          setLead(data.lead);
          setActivities(data.activities || []);
        })
        .catch(() => {
          toast("error", "Failed to load lead");
        })
        .finally(() => {
          setLoading(false);
        }),
    [leadId, toast, router]
  );

  // Fetch customer history (other leads + past payments) from EXISTING
  // endpoints only. Fails soft per-source so a failure in one (e.g. the
  // operator lacks payments:view) never breaks the section or the page.
  // Callers flip historyLoading=true beforehand (see the render-phase check below).
  const fetchHistory = React.useCallback((customerId: string, currentLeadId: string) =>
    Promise.allSettled([
      fetch(`/api/customers/${customerId}`),
      fetch(`/api/payments?customerId=${encodeURIComponent(customerId)}&limit=50`),
    ])
      .then(async ([custRes, payRes]) => {
        // Other leads — exclude the lead currently open on this page.
        if (custRes.status === "fulfilled" && custRes.value.ok) {
          try {
            const data = await custRes.value.json();
            const leads: HistoryLead[] = Array.isArray(data.leads) ? data.leads : [];
            setHistoryLeads(leads.filter((l) => l.id !== currentLeadId));
          } catch {
            setHistoryLeads([]);
          }
        } else {
          setHistoryLeads([]);
        }

        // Past payments — the endpoint requires payments:view; treat a 403 as
        // "not available to this role" rather than an error.
        if (payRes.status === "fulfilled" && payRes.value.ok) {
          try {
            const data = await payRes.value.json();
            setHistoryPayments(Array.isArray(data.payments) ? data.payments : []);
            setHistoryPaymentsAvailable(true);
          } catch {
            setHistoryPayments([]);
            setHistoryPaymentsAvailable(true);
          }
        } else {
          setHistoryPayments([]);
          setHistoryPaymentsAvailable(
            !(payRes.status === "fulfilled" && payRes.value.status === 403),
          );
        }
      })
      .catch(() => {
        // Total failure — leave whatever we had; section shows empty states.
        setHistoryLeads([]);
        setHistoryPayments([]);
      })
      .finally(() => {
        setHistoryLoading(false);
        setHistoryLoaded(true);
      }), []);

  // Load history once the lead (and therefore its customer id) is known.
  // The loading flag is raised during render (adjust-state-on-change pattern);
  // the effect below then performs the single fetch.
  const historyCustomerId = lead?.customer?.id ?? null;
  const historyLeadId = lead?.id ?? null;
  if (historyCustomerId && !historyLoaded && !historyLoading) {
    setHistoryLoading(true);
  }

  React.useEffect(() => {
    if (historyCustomerId && historyLeadId && !historyLoaded) {
      fetchHistory(historyCustomerId, historyLeadId);
    }
  }, [historyCustomerId, historyLeadId, historyLoaded, fetchHistory]);

  // Fetch reference data
  React.useEffect(() => {
    async function fetchRefs() {
      try {
        const [stageRes] = await Promise.all([
          fetch("/api/pipeline-stages"),
        ]);
        if (stageRes.ok) {
          const stageData = await stageRes.json();
          setStages(stageData.stages || []);
        }

        try {
          const agentRes = await fetch("/api/auth/users?role=AGENT&role=DEPT_MANAGER&role=COMPANY_ADMIN");
          if (agentRes.ok) {
            const agentData = await agentRes.json();
            setAgents(agentData.users || []);
          }
        } catch {
          // Not critical
        }
      } catch {
        // Stages fetch failure
      }
    }
    fetchRefs();
    fetchLead();
  }, [fetchLead]);

  // Change stage
  async function handleChangeStage(stageId: string) {
    if (!lead || stageId === lead.stage.id) return;
    setChangingStage(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change-stage", stageId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change stage");
      }
      toast("success", "Stage updated");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to change stage");
    } finally {
      setChangingStage(false);
    }
  }

  // Assign agent
  async function handleAssignAgent(agentId: string) {
    if (!lead) return;
    if (!agentId) return; // Can't unassign via this action
    if (agentId === lead.assignee?.id) return;
    setAssigningAgent(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", agentId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to assign agent");
      }
      toast("success", "Agent assigned");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to assign agent");
    } finally {
      setAssigningAgent(false);
    }
  }

  // Add note
  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-note", content: noteText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add note");
      }
      setNoteText("");
      toast("success", "Note added");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setAddingNote(false);
    }
  }

  // Schedule callback
  async function handleScheduleCallback(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !callbackTime) return;
    setSubmittingCallback(true);
    try {
      const res = await fetch("/api/callbacks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          departmentId: lead.department.id,
          assignedTo: lead.assignee?.id || undefined,
          preferredTime: callbackTime,
          notes: callbackNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to schedule callback");
      }
      toast("success", "Callback scheduled");
      setCallbackModal(false);
      setCallbackTime("");
      setCallbackNotes("");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to schedule callback");
    } finally {
      setSubmittingCallback(false);
    }
  }

  // Create follow-up
  async function handleCreateFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !followUpDate) return;
    setSubmittingFollowUp(true);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          assignedTo: lead.assignee?.id || agents[0]?.id,
          type: followUpType,
          scheduledAt: followUpDate,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create follow-up");
      }
      toast("success", "Follow-up created");
      setFollowUpModal(false);
      setFollowUpType("REMINDER");
      setFollowUpDate("");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create follow-up");
    } finally {
      setSubmittingFollowUp(false);
    }
  }

  // Start conversation
  async function handleStartConversation() {
    if (!lead) return;
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start conversation");
      }
      toast("success", "Conversation started");
      router.push("/conversations");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to start conversation");
    }
  }

  // Escalate
  async function handleEscalate(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !escalationTo) return;
    setSubmittingEscalation(true);
    try {
      const res = await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          reason: escalationReason,
          escalatedTo: escalationTo,
          notes: escalationNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to escalate");
      }
      toast("success", "Lead escalated successfully");
      setEscalateModal(false);
      setEscalationReason("COMPLEX_REQUEST");
      setEscalationNotes("");
      setEscalationTo("");
      fetchLead();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to escalate");
    } finally {
      setSubmittingEscalation(false);
    }
  }

  // Delete lead
  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this lead? This action cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete lead");
      }
      toast("success", "Lead deleted");
      router.push("/leads");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete lead");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-500">
        <p>Lead not found</p>
        <Button variant="secondary" className="mt-3" onClick={() => router.push("/leads")}>
          Back to Leads
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/leads")}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{lead.customer.name}</h1>
            <p className="text-xs text-gray-500">
              Lead created {new Date(lead.createdAt).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={handleDelete} loading={deleting}>
          <Trash2 className="h-4 w-4 text-red-500" />
          Delete
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (2/3) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Customer info card */}
          <Card header="Customer Information">
            <div className="flex items-start gap-4">
              <Avatar name={lead.customer.name} size="lg" />
              <div className="flex-1 space-y-2">
                <h3 className="text-base font-semibold text-gray-900">{lead.customer.name}</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-700">{lead.customer.mobile}</span>
                  </div>
                  {lead.customer.alternatePhone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">{lead.customer.alternatePhone} (alt)</span>
                    </div>
                  )}
                  {lead.customer.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-700">{lead.customer.email}</span>
                    </div>
                  )}
                  {lead.customer.address && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-700">{lead.customer.address}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Activity timeline */}
          <Card header="Activity Timeline">
            <ActivityTimeline activities={activities} />

            {/* Add note form */}
            <form onSubmit={handleAddNote} className="mt-4 border-t border-gray-200 pt-4">
              <div className="flex gap-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <Button
                  type="submit"
                  size="sm"
                  loading={addingNote}
                  disabled={!noteText.trim()}
                  className="self-end"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </Card>

          {/* Customer History — this customer's OTHER leads + past payments,
              so the agent has full context while working the current lead.
              All data is real (from /api/customers/[id] and /api/payments);
              each source fails soft and shows a friendly empty state. */}
          <Card>
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <History className="h-4 w-4 text-gray-400" />
                Customer History
                {historyLoaded && (
                  <span className="text-xs font-normal text-gray-400">
                    ({historyLeads.length} lead{historyLeads.length === 1 ? "" : "s"}
                    {historyPaymentsAvailable ? `, ${historyPayments.length} payment${historyPayments.length === 1 ? "" : "s"}` : ""})
                  </span>
                )}
              </span>
              {historyOpen ? (
                <ChevronUp className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              )}
            </button>

            {historyOpen && (
              <div className="mt-4 space-y-6 border-t border-gray-200 pt-4">
                {historyLoading ? (
                  <div className="flex h-24 items-center justify-center">
                    <Spinner size="md" />
                  </div>
                ) : (
                  <>
                    {/* Other leads */}
                    <div>
                      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Other Leads
                      </h4>
                      {historyLeads.length === 0 ? (
                        <p className="text-sm text-gray-400">No previous leads.</p>
                      ) : (
                        <div className="space-y-2">
                          {historyLeads.map((hl) => (
                            <button
                              key={hl.id}
                              type="button"
                              onClick={() => router.push(`/leads/${hl.id}`)}
                              className="flex w-full items-center justify-between rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={historyStageVariant(hl.stage.name)} size="sm">
                                    {hl.stage.name}
                                  </Badge>
                                  <Badge variant="default" size="sm">
                                    {hl.department.name}
                                  </Badge>
                                </div>
                                {hl.destination && (
                                  <p className="mt-1.5 truncate text-sm text-gray-700">{hl.destination}</p>
                                )}
                              </div>
                              <span className="ml-3 flex shrink-0 items-center gap-1 text-xs text-gray-500">
                                <Calendar className="h-3 w-3" />
                                {formatHistoryDate(hl.createdAt)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Past payments */}
                    <div>
                      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Past Payments
                      </h4>
                      {!historyPaymentsAvailable ? (
                        <p className="text-sm text-gray-400">
                          You don&apos;t have access to view payments.
                        </p>
                      ) : historyPayments.length === 0 ? (
                        <p className="text-sm text-gray-400">No previous payments.</p>
                      ) : (
                        <div className="space-y-2">
                          {historyPayments.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="h-4 w-4 shrink-0 text-gray-400" />
                                  <span className="text-sm font-semibold text-gray-900">
                                    {inr.format(p.amountPaise / 100)}
                                  </span>
                                  <Badge variant={paymentStatusVariant(p.status)} size="sm">
                                    {p.status}
                                  </Badge>
                                </div>
                                <p className="mt-1 truncate text-xs text-gray-500">
                                  {p.tour
                                    ? `${p.tour.name} (${p.tour.code})`
                                    : p.lead?.destination || "General booking"}
                                </p>
                              </div>
                              <span className="ml-3 shrink-0 text-xs text-gray-500">
                                {formatHistoryDate(p.createdAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Right column (1/3) */}
        <div className="space-y-6">
          {/* AI Insights */}
          <AiInsightsPanel leadId={leadId} />

          <LeadDetailPanel
            lead={lead}
            stages={stages}
            agents={agents}
            onChangeStage={handleChangeStage}
            onAssignAgent={handleAssignAgent}
            onScheduleCallback={() => setCallbackModal(true)}
            onCreateFollowUp={() => setFollowUpModal(true)}
            onStartConversation={handleStartConversation}
            onEscalate={() => setEscalateModal(true)}
            changingStage={changingStage}
            assigningAgent={assigningAgent}
          />

          {/* Phase 6i — Tour booking surface (was the biggest workflow gap
              identified by the travel-agent UX audit). fetchLead() reloads
              both the lead AND its activities, so the new payment + booking
              show up in the timeline as soon as the operator returns. */}
          <BookTourCard
            customerId={lead.customer.id}
            leadId={lead.id}
            onBooked={fetchLead}
          />
        </div>
      </div>

      {/* Schedule Callback Modal */}
      {callbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Schedule Callback</h3>
              <button onClick={() => setCallbackModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleScheduleCallback} className="space-y-4">
              <Input
                label="Preferred Time"
                type="datetime-local"
                value={callbackTime}
                onChange={(e) => setCallbackTime(e.target.value)}
                required
              />
              <div className="w-full">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Notes (optional)</label>
                <textarea
                  value={callbackNotes}
                  onChange={(e) => setCallbackNotes(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="Any notes for this callback..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setCallbackModal(false)}>Cancel</Button>
                <Button type="submit" loading={submittingCallback}>Schedule</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Follow-up Modal */}
      {followUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Create Follow-up</h3>
              <button onClick={() => setFollowUpModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateFollowUp} className="space-y-4">
              <Select
                label="Follow-up Type"
                value={followUpType}
                onChange={(e) => setFollowUpType(e.target.value)}
                options={[
                  { label: "Reminder", value: "REMINDER" },
                  { label: "Quotation", value: "QUOTATION" },
                  { label: "Document", value: "DOCUMENT" },
                  { label: "Payment", value: "PAYMENT" },
                  { label: "Re-engage", value: "RE_ENGAGE" },
                ]}
              />
              <Input
                label="Scheduled Date"
                type="datetime-local"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                required
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setFollowUpModal(false)}>Cancel</Button>
                <Button type="submit" loading={submittingFollowUp}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Escalate Modal */}
      {escalateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Escalate Lead</h3>
              <button onClick={() => setEscalateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEscalate} className="space-y-4">
              <Select
                label="Reason"
                value={escalationReason}
                onChange={(e) => setEscalationReason(e.target.value)}
                options={[
                  { label: "Complex Request", value: "COMPLEX_REQUEST" },
                  { label: "VIP Client", value: "VIP_CLIENT" },
                  { label: "Payment Issue", value: "PAYMENT_ISSUE" },
                  { label: "Technical Issue", value: "TECHNICAL_ISSUE" },
                  { label: "Repeated Failure", value: "REPEATED_FAILURE" },
                  { label: "Customer Request", value: "CUSTOMER_REQUEST" },
                ]}
              />
              <Select
                label="Escalate To"
                value={escalationTo}
                onChange={(e) => setEscalationTo(e.target.value)}
                options={agents.map((a) => ({ label: a.name, value: a.id }))}
                placeholder="Select a user..."
              />
              <div className="w-full">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Notes (optional)</label>
                <textarea
                  value={escalationNotes}
                  onChange={(e) => setEscalationNotes(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="Reason for escalation..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" type="button" onClick={() => setEscalateModal(false)}>Cancel</Button>
                <Button variant="danger" type="submit" loading={submittingEscalation} disabled={!escalationTo}>Escalate</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
