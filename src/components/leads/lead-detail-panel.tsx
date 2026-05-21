"use client";

import * as React from "react";
import {
  MapPin,
  Calendar,
  Users,
  Plane,
  Tag,
  Building2,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const priorityVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  VIP: "danger",
};

const sourceLabels: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  FB: "Facebook",
  IG: "Instagram",
  MANUAL: "Manual",
};

interface Stage {
  id: string;
  name: string;
  color: string | null;
}

interface Agent {
  id: string;
  name: string;
}

interface LeadInfo {
  id: string;
  destination: string | null;
  travelDate: string | null;
  numPassengers: number | null;
  specialRequirement: string | null;
  source: string;
  priority: string;
  isFutureInterest: boolean;
  department: { id: string; name: string; color: string | null };
  stage: { id: string; name: string; color: string | null };
  assignee: { id: string; name: string } | null;
}

interface LeadDetailPanelProps {
  lead: LeadInfo;
  stages: Stage[];
  agents: Agent[];
  onChangeStage: (stageId: string) => void;
  onAssignAgent: (agentId: string) => void;
  onScheduleCallback?: () => void;
  onCreateFollowUp?: () => void;
  changingStage?: boolean;
  assigningAgent?: boolean;
}

export function LeadDetailPanel({
  lead,
  stages,
  agents,
  onChangeStage,
  onAssignAgent,
  onScheduleCallback,
  onCreateFollowUp,
  changingStage,
  assigningAgent,
}: LeadDetailPanelProps) {
  function formatDate(dateStr: string | null) {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  const stageOptions = stages.map((s) => ({ label: s.name, value: s.id }));
  const agentOptions = [
    { label: "Unassigned", value: "" },
    ...agents.map((a) => ({ label: a.name, value: a.id })),
  ];

  return (
    <div className="space-y-4">
      {/* Lead Info Card */}
      <Card header="Lead Information">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Department:</span>
            <Badge
              size="sm"
              style={
                lead.department.color
                  ? { backgroundColor: `${lead.department.color}20`, color: lead.department.color }
                  : undefined
              }
            >
              {lead.department.name}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Stage:</span>
            <Badge
              size="sm"
              style={
                lead.stage.color
                  ? { backgroundColor: `${lead.stage.color}20`, color: lead.stage.color }
                  : undefined
              }
            >
              {lead.stage.name}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Tag className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Priority:</span>
            <Badge variant={priorityVariant[lead.priority] || "default"} size="sm">
              {lead.priority}
            </Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Plane className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Source:</span>
            <span className="text-gray-700">{sourceLabels[lead.source] || lead.source}</span>
          </div>

          {lead.destination && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-gray-500">Destination:</span>
              <span className="text-gray-700">{lead.destination}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-gray-500">Travel Date:</span>
            <span className="text-gray-700">{formatDate(lead.travelDate)}</span>
          </div>

          {lead.numPassengers != null && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-gray-500">Passengers:</span>
              <span className="text-gray-700">{lead.numPassengers}</span>
            </div>
          )}

          {lead.specialRequirement && (
            <div className="flex items-start gap-2 text-sm">
              <FileText className="mt-0.5 h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <span className="text-gray-500">Special Requirements:</span>
                <p className="mt-0.5 text-gray-700">{lead.specialRequirement}</p>
              </div>
            </div>
          )}

          {lead.isFutureInterest && (
            <Badge variant="warning" size="sm">Future Interest</Badge>
          )}
        </div>
      </Card>

      {/* Quick Actions */}
      <Card header="Quick Actions">
        <div className="space-y-3">
          <Select
            label="Change Stage"
            options={stageOptions}
            value={lead.stage.id}
            onChange={(e) => onChangeStage(e.target.value)}
            disabled={changingStage}
          />

          <Select
            label="Assign Agent"
            options={agentOptions}
            value={lead.assignee?.id || ""}
            onChange={(e) => onAssignAgent(e.target.value)}
            disabled={assigningAgent}
          />

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={onScheduleCallback}
            >
              Schedule Callback
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              onClick={onCreateFollowUp}
            >
              Create Follow-up
            </Button>
          </div>
        </div>
      </Card>

      {/* File Attachments placeholder */}
      <Card header="Attachments">
        <p className="text-sm text-gray-400">
          File attachments will be available here.
        </p>
      </Card>
    </div>
  );
}
