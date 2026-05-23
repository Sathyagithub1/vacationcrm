"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Phone, Calendar, Download, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScoreBadge } from "@/components/leads/score-badge";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

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

export interface LeadRow {
  id: string;
  destination: string | null;
  travelDate: string | null;
  priority: string;
  source: string;
  isFutureInterest: boolean;
  createdAt: string;
  stageId: string;
  score?: number | null;
  customer: { id: string; name: string; mobile: string; email: string | null };
  department: { id: string; name: string; color: string | null };
  stage: { id: string; name: string; color: string | null; position: number };
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

interface LeadTableProps {
  leads: LeadRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkAssign?: () => void;
  onBulkStageChange?: () => void;
  onExportCsv?: () => void;
  showBulkActions?: boolean;
  sortByScore?: "asc" | "desc" | null;
  onSortByScore?: () => void;
}

export function LeadTable({
  leads,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkAssign,
  onBulkStageChange,
  onExportCsv,
  showBulkActions,
  sortByScore,
  onSortByScore,
}: LeadTableProps) {
  const router = useRouter();
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div>
      {/* Bulk actions bar */}
      {showBulkActions && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border-b border-gray-200 bg-primary-50 px-4 py-2">
          <span className="text-sm font-medium text-primary-700">
            {selectedIds.size} selected
          </span>
          {onBulkAssign && (
            <Button size="sm" variant="secondary" onClick={onBulkAssign}>
              Assign
            </Button>
          )}
          {onBulkStageChange && (
            <Button size="sm" variant="secondary" onClick={onBulkStageChange}>
              Change Stage
            </Button>
          )}
          {onExportCsv && (
            <Button size="sm" variant="secondary" onClick={onExportCsv}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
            </TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>
              <button
                onClick={onSortByScore}
                className="inline-flex items-center gap-1 hover:text-gray-900"
                title="Sort by score"
                type="button"
              >
                Score
                <ArrowUpDown className={cn(
                  "h-3.5 w-3.5",
                  sortByScore ? "text-primary-500" : "text-gray-400"
                )} />
              </button>
            </TableHead>
            <TableHead>Mobile</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead>Travel Date</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="py-12 text-center text-gray-500">
                No leads found.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                onClick={() => router.push(`/leads/${lead.id}`)}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleSelect(lead.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.customer.name} size="sm" />
                    <span className="font-medium text-gray-900">{lead.customer.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <ScoreBadge score={lead.score} size="sm" />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                    {lead.customer.mobile}
                  </span>
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <Badge variant={priorityVariant[lead.priority] || "default"} size="sm">
                    {lead.priority}
                  </Badge>
                </TableCell>
                <TableCell>
                  {lead.assignee ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar name={lead.assignee.name} size="sm" imageUrl={lead.assignee.avatarUrl || undefined} />
                      <span className="text-sm text-gray-700">{lead.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>
                  {lead.travelDate ? (
                    <span className="flex items-center gap-1 text-sm text-gray-600">
                      <Calendar className="h-3.5 w-3.5 text-gray-400" />
                      {formatDate(lead.travelDate)}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">--</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-gray-600">
                    {sourceLabels[lead.source] || lead.source}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-gray-600">
                  {formatDate(lead.createdAt)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
