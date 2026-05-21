"use client";

import { Phone, Mail, MapPin, Building2, Tag, Calendar, Users as UsersIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface CustomerInfoPanelProps {
  conversation: {
    id: string;
    status: string;
    startedAt: string;
    lead: {
      id: string;
      destination: string | null;
      travelDate: string | null;
      numPassengers: number | null;
      source: string;
      priority: string;
      customer: {
        id: string;
        name: string;
        mobile: string;
        email: string | null;
        address: string | null;
      };
      department: { id: string; name: string; color: string | null };
      stage: { id: string; name: string; color: string | null };
      assignee: { id: string; name: string; avatarUrl: string | null } | null;
    };
    agent: { id: string; name: string; avatarUrl: string | null } | null;
  } | null;
}

const priorityVariant: Record<string, "default" | "info" | "warning" | "success" | "danger" | "primary"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  VIP: "danger",
};

export function CustomerInfoPanel({ conversation }: CustomerInfoPanelProps) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center border-l border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-400">Select a conversation to see customer details</p>
      </div>
    );
  }

  const { lead } = conversation;
  const { customer } = lead;

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="h-full overflow-y-auto border-l border-gray-200 bg-white p-4">
      {/* Customer card */}
      <div className="mb-4 text-center">
        <Avatar name={customer.name} size="lg" className="mx-auto" />
        <h3 className="mt-2 text-sm font-semibold text-gray-900">{customer.name}</h3>
        <div className="mt-1 space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-xs text-gray-600">
            <Phone className="h-3 w-3" />
            {customer.mobile}
          </div>
          {customer.email && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-600">
              <Mail className="h-3 w-3" />
              {customer.email}
            </div>
          )}
          {customer.address && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-600">
              <MapPin className="h-3 w-3" />
              {customer.address}
            </div>
          )}
        </div>
      </div>

      {/* Lead summary */}
      <div className="space-y-3 rounded-lg border border-gray-200 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Lead Summary
        </h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="h-3.5 w-3.5 text-gray-400" />
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
          <div className="flex items-center gap-2 text-xs">
            <Tag className="h-3.5 w-3.5 text-gray-400" />
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
          <div className="flex items-center gap-2 text-xs">
            <Tag className="h-3.5 w-3.5 text-gray-400" />
            <Badge variant={priorityVariant[lead.priority] || "default"} size="sm">
              {lead.priority}
            </Badge>
          </div>
          {lead.destination && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <MapPin className="h-3.5 w-3.5 text-gray-400" />
              {lead.destination}
            </div>
          )}
          {lead.travelDate && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <Calendar className="h-3.5 w-3.5 text-gray-400" />
              {formatDate(lead.travelDate)}
            </div>
          )}
          {lead.numPassengers != null && (
            <div className="flex items-center gap-2 text-xs text-gray-700">
              <UsersIcon className="h-3.5 w-3.5 text-gray-400" />
              {lead.numPassengers} passengers
            </div>
          )}
        </div>
      </div>

      {/* Assigned agent */}
      {conversation.agent && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Assigned Agent
          </h4>
          <div className="flex items-center gap-2">
            <Avatar
              name={conversation.agent.name}
              imageUrl={conversation.agent.avatarUrl || undefined}
              size="sm"
            />
            <span className="text-sm text-gray-900">{conversation.agent.name}</span>
          </div>
        </div>
      )}

      {/* View lead link */}
      <div className="mt-4">
        <a
          href={`/leads/${lead.id}`}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          View Full Lead Details
        </a>
      </div>
    </div>
  );
}
