"use client";

import * as React from "react";
import {
  Send,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  Mail,
  MessageSquare,
  Smartphone,
  Monitor,
  Users,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";
import { format } from "date-fns";

type Broadcast = {
  id: string;
  title: string;
  content: string;
  channel: string;
  targetType: string;
  targetFilter: Record<string, unknown> | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: string;
  creator: { id: string; name: string; avatarUrl: string | null };
};

const CHANNELS = [
  { key: "EMAIL", label: "Email", icon: Mail },
  { key: "SMS", label: "SMS", icon: Smartphone },
  { key: "WHATSAPP", label: "WhatsApp", icon: MessageSquare },
  { key: "IN_APP", label: "In-App", icon: Monitor },
];

const TARGET_TYPES = [
  { key: "ALL_CUSTOMERS", label: "All Customers" },
  { key: "DEPARTMENT", label: "By Department" },
  { key: "STAGE", label: "By Pipeline Stage" },
  { key: "CUSTOM_FILTER", label: "Custom Filter" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  DRAFT: { label: "Draft", color: "bg-gray-100 text-gray-700", icon: FileText },
  SCHEDULED: { label: "Scheduled", color: "bg-blue-100 text-blue-700", icon: Clock },
  SENDING: { label: "Sending", color: "bg-yellow-100 text-yellow-700", icon: Loader2 },
  SENT: { label: "Sent", color: "bg-green-100 text-green-700", icon: CheckCircle },
  FAILED: { label: "Failed", color: "bg-red-100 text-red-700", icon: XCircle },
};

function getChannelIcon(channel: string) {
  const ch = CHANNELS.find((c) => c.key === channel);
  return ch ? ch.icon : Mail;
}

// ─── Create/Edit Form ─────────────────────────────────────────────────────
function BroadcastForm({
  onSaved,
  onCancel,
  editBroadcast,
}: {
  onSaved: () => void;
  onCancel: () => void;
  editBroadcast?: Broadcast | null;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [title, setTitle] = React.useState(editBroadcast?.title || "");
  const [content, setContent] = React.useState(editBroadcast?.content || "");
  const [channel, setChannel] = React.useState(editBroadcast?.channel || "EMAIL");
  const [targetType, setTargetType] = React.useState(editBroadcast?.targetType || "ALL_CUSTOMERS");
  const [scheduledAt, setScheduledAt] = React.useState(
    editBroadcast?.scheduledAt ? editBroadcast.scheduledAt.slice(0, 16) : ""
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast("error", "Title and content are required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        content: content.trim(),
        channel,
        targetType,
        targetFilter: null,
        scheduledAt: scheduledAt || null,
      };

      const url = editBroadcast ? `/api/broadcasts/${editBroadcast.id}` : "/api/broadcasts";
      const method = editBroadcast ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save broadcast");
      }

      toast("success", editBroadcast ? "Broadcast updated" : "Broadcast created");
      onSaved();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          placeholder="Broadcast title..."
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          placeholder="Message content..."
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            {CHANNELS.map((ch) => (
              <option key={ch.key} value={ch.key}>
                {ch.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            {TARGET_TYPES.map((tt) => (
              <option key={tt.key} value={tt.key}>
                {tt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Schedule (optional)
        </label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : editBroadcast ? "Update Draft" : "Create Draft"}
        </Button>
      </div>
    </form>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────
function BroadcastDetail({
  broadcastId,
  onBack,
  onRefresh,
}: {
  broadcastId: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [broadcast, setBroadcast] = React.useState<Broadcast | null>(null);
  const [recipientStats, setRecipientStats] = React.useState({ pending: 0, delivered: 0, failed: 0 });
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);

  async function fetchDetail() {
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setBroadcast(data.broadcast);
      setRecipientStats(data.recipientStats || { pending: 0, delivered: 0, failed: 0 });
    } catch {
      toast("error", "Failed to load broadcast");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchDetail();
  }, [broadcastId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    if (!confirm("Send this broadcast now? This cannot be undone.")) return;
    setSending(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send");
      }
      const data = await res.json();
      toast("success", data.message || "Broadcast sent");
      fetchDetail();
      onRefresh();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!broadcast) {
    return (
      <div className="text-center py-12 text-gray-500">Broadcast not found</div>
    );
  }

  const ChannelIcon = getChannelIcon(broadcast.channel);
  const statusCfg = STATUS_CONFIG[broadcast.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-semibold text-gray-900 flex-1">{broadcast.title}</h2>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}>
          <StatusIcon className="h-3 w-3" />
          {statusCfg.label}
        </span>
        {(broadcast.status === "DRAFT" || broadcast.status === "SCHEDULED") && (
          <Button onClick={handleSend} disabled={sending} size="sm">
            <Send className="h-4 w-4 mr-1" />
            {sending ? "Sending..." : "Send Now"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500 mb-1">Channel</div>
          <div className="flex items-center gap-2 font-medium">
            <ChannelIcon className="h-4 w-4" />
            {CHANNELS.find((c) => c.key === broadcast.channel)?.label || broadcast.channel}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500 mb-1">Target</div>
          <div className="flex items-center gap-2 font-medium">
            <Users className="h-4 w-4" />
            {TARGET_TYPES.find((t) => t.key === broadcast.targetType)?.label || broadcast.targetType}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500 mb-1">Created By</div>
          <div className="font-medium">{broadcast.creator.name}</div>
          <div className="text-xs text-gray-400">
            {format(new Date(broadcast.createdAt), "MMM d, yyyy h:mm a")}
          </div>
        </div>
      </div>

      {/* Delivery Stats */}
      {broadcast.totalRecipients > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{broadcast.totalRecipients}</div>
            <div className="text-sm text-gray-500">Total</div>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
            <div className="text-2xl font-bold text-green-700">{recipientStats.delivered}</div>
            <div className="text-sm text-green-600">Delivered</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <div className="text-2xl font-bold text-red-700">{recipientStats.failed}</div>
            <div className="text-sm text-red-600">Failed</div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-700 mb-2">Content</div>
        <div className="text-sm text-gray-600 whitespace-pre-wrap">{broadcast.content}</div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function BroadcastsPage() {
  const { toast } = useToast();
  const [broadcasts, setBroadcasts] = React.useState<Broadcast[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [view, setView] = React.useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState("");

  async function fetchBroadcasts() {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/broadcasts?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setBroadcasts(data.broadcasts);
      setTotalPages(data.totalPages);
    } catch {
      toast("error", "Failed to load broadcasts");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchBroadcasts();
  }, [page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === "create") {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-gray-900">New Broadcast</h1>
        <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-6">
          <BroadcastForm
            onSaved={() => {
              setView("list");
              fetchBroadcasts();
            }}
            onCancel={() => setView("list")}
          />
        </div>
      </div>
    );
  }

  if (view === "detail" && selectedId) {
    return (
      <BroadcastDetail
        broadcastId={selectedId}
        onBack={() => {
          setView("list");
          setSelectedId(null);
        }}
        onRefresh={fetchBroadcasts}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Send className="h-5 w-5" />
          Broadcasts
        </h1>
        <Button onClick={() => setView("create")}>
          <Plus className="h-4 w-4 mr-1" />
          New Broadcast
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["", "DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED"].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              statusFilter === s
                ? "bg-primary-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-gray-400">
          <Send className="h-12 w-12 mb-3" />
          <p>No broadcasts yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {broadcasts.map((b) => {
            const statusCfg = STATUS_CONFIG[b.status] || STATUS_CONFIG.DRAFT;
            const StatusIcon = statusCfg.icon;
            const ChannelIcon = getChannelIcon(b.channel);

            return (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedId(b.id);
                  setView("detail");
                }}
                className="w-full text-left rounded-lg border border-gray-200 bg-white p-4 hover:border-primary-300 hover:shadow-sm transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <ChannelIcon className="h-5 w-5 text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{b.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        by {b.creator.name} &middot;{" "}
                        {format(new Date(b.createdAt), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {b.totalRecipients > 0 && (
                      <span className="text-xs text-gray-500">
                        {b.deliveredCount}/{b.totalRecipients}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {statusCfg.label}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
