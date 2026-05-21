"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { ActivityTimeline, type Activity } from "@/components/leads/activity-timeline";
import { LeadDetailPanel } from "@/components/leads/lead-detail-panel";

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

  // Note form
  const [noteText, setNoteText] = React.useState("");
  const [addingNote, setAddingNote] = React.useState(false);

  // Action states
  const [changingStage, setChangingStage] = React.useState(false);
  const [assigningAgent, setAssigningAgent] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // Fetch lead detail
  const fetchLead = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast("error", "Lead not found");
          router.push("/leads");
          return;
        }
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setLead(data.lead);
      setActivities(data.activities || []);
    } catch {
      toast("error", "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [leadId, toast, router]);

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
        </div>

        {/* Right column (1/3) */}
        <div>
          <LeadDetailPanel
            lead={lead}
            stages={stages}
            agents={agents}
            onChangeStage={handleChangeStage}
            onAssignAgent={handleAssignAgent}
            changingStage={changingStage}
            assigningAgent={assigningAgent}
          />
        </div>
      </div>
    </div>
  );
}
