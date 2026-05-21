"use client";

import { Calendar, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const priorityConfig: Record<string, { label: string; color: string }> = {
  LOW: { label: "Low", color: "bg-gray-300" },
  MEDIUM: { label: "Med", color: "bg-blue-400" },
  HIGH: { label: "High", color: "bg-orange-400" },
  VIP: { label: "VIP", color: "bg-red-500" },
};

export interface LeadCardData {
  id: string;
  destination: string | null;
  travelDate: string | null;
  priority: string;
  source: string;
  customer: { id: string; name: string; mobile: string };
  department: { id: string; name: string; color: string | null };
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

interface LeadCardProps {
  lead: LeadCardData;
  onClick?: () => void;
  isDragging?: boolean;
}

export function LeadCard({ lead, onClick, isDragging }: LeadCardProps) {
  const prio = priorityConfig[lead.priority] || priorityConfig.MEDIUM;

  function formatDate(dateStr: string | null) {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md",
        isDragging && "rotate-2 shadow-lg opacity-90"
      )}
    >
      {/* Priority indicator line */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 truncate">
          {lead.customer.name}
        </span>
        <span
          className={cn("h-2 w-2 rounded-full shrink-0", prio.color)}
          title={prio.label}
        />
      </div>

      {/* Department badge */}
      <div className="mb-2">
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

      {/* Info row */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        {lead.destination && (
          <span className="flex items-center gap-1 truncate">
            <MapPin className="h-3 w-3 shrink-0" />
            {lead.destination}
          </span>
        )}
        {lead.travelDate && (
          <span className="flex items-center gap-1 shrink-0">
            <Calendar className="h-3 w-3" />
            {formatDate(lead.travelDate)}
          </span>
        )}
      </div>

      {/* Assigned agent */}
      {lead.assignee && (
        <div className="mt-2 flex items-center gap-1.5">
          <Avatar name={lead.assignee.name} size="sm" imageUrl={lead.assignee.avatarUrl || undefined} />
          <span className="text-xs text-gray-500 truncate">{lead.assignee.name}</span>
        </div>
      )}
    </div>
  );
}
