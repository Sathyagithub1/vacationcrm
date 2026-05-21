"use client";

import * as React from "react";
import { MessageSquare, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface ConversationListItem {
  id: string;
  status: string;
  startedAt: string;
  lead: {
    id: string;
    customer: { id: string; name: string; mobile: string };
    department: { id: string; name: string; color: string | null };
  };
  agent: { id: string; name: string; avatarUrl: string | null } | null;
  messages: Array<{ content: string; createdAt: string; senderType: string }>;
}

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}

const statusVariant: Record<string, "success" | "warning" | "default"> = {
  ACTIVE: "success",
  HUMAN_TAKEOVER: "warning",
  CLOSED: "default",
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilterChange,
}: ConversationListProps) {
  const [search, setSearch] = React.useState("");

  const filtered = conversations.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        c.lead.customer.name.toLowerCase().includes(q) ||
        c.lead.customer.mobile.includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Conversations</h2>
        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-gray-300 bg-white pl-8 pr-3 text-xs placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
        {/* Status filter */}
        <div className="mt-2 flex gap-1">
          {[
            { label: "All", value: "" },
            { label: "Active", value: "ACTIVE" },
            { label: "Closed", value: "CLOSED" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStatusFilterChange(opt.value)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                statusFilter === opt.value
                  ? "bg-primary-100 text-primary-700"
                  : "text-gray-500 hover:bg-gray-100"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <MessageSquare className="mb-2 h-8 w-8" />
            <p className="text-xs">No conversations</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const lastMsg = conv.messages[0];
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50",
                  selectedId === conv.id && "bg-primary-50"
                )}
              >
                <Avatar name={conv.lead.customer.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {conv.lead.customer.name}
                    </span>
                    <Badge
                      variant={statusVariant[conv.status] || "default"}
                      size="sm"
                      className="ml-1 shrink-0"
                    >
                      {conv.status === "ACTIVE" ? "Active" : conv.status === "CLOSED" ? "Closed" : conv.status}
                    </Badge>
                  </div>
                  {lastMsg && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {lastMsg.senderType === "AGENT" ? "You: " : ""}
                      {lastMsg.content}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {conv.lead.department.name}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
