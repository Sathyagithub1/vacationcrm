"use client";

/**
 * src/app/(dashboard)/settings/voice/page.tsx
 *
 * Phase 6d — Voice call history / IVR settings page.
 *
 * Displays a searchable table of voice calls for the current tenant with:
 *   - Direction badge (INBOUND / OUTBOUND)
 *   - Status badge (coloured)
 *   - Intent
 *   - Language
 *   - Duration
 *   - Segment count
 *   - Customer name / number
 *   - Date/time
 *
 * Clicking a row expands an inline segment timeline for that call.
 *
 * Filters:
 *   - Status dropdown
 *   - Date range
 *   - Language
 *
 * All data comes from GET /api/voice-calls and GET /api/voice-calls/:id.
 */

import * as React from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoiceCallSummary {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromNumber: string;
  toNumber: string;
  status: string;
  intent: string | null;
  language: string | null;
  durationSeconds: number | null;
  startedAt: string;
  customer: { id: string; name: string; mobile: string } | null;
  _count: { segments: number };
}

interface VoiceCallDetail extends VoiceCallSummary {
  segments: Array<{
    id: string;
    speaker: "CUSTOMER" | "BOT" | "AGENT";
    content: string;
    audioUrl: string | null;
    startMs: number;
    endMs: number | null;
    createdAt: string;
  }>;
}

interface ListResponse {
  voiceCalls: VoiceCallSummary[];
  total: number;
  page: number;
  totalPages: number;
}

// ── Status colour map ─────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  RINGING:     "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED:   "bg-green-100 text-green-800",
  FAILED:      "bg-red-100 text-red-800",
  MISSED:      "bg-orange-100 text-orange-800",
  VOICEMAIL:   "bg-purple-100 text-purple-800",
};

const SPEAKER_COLOURS: Record<string, string> = {
  CUSTOMER: "bg-indigo-50 border-indigo-200",
  BOT:      "bg-gray-50 border-gray-200",
  AGENT:    "bg-green-50 border-green-200",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function VoiceCallsPage() {
  const [calls, setCalls] = React.useState<VoiceCallSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = React.useState("");
  const [languageFilter, setLanguageFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // Expanded call for segment timeline
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = React.useState<VoiceCallDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const fetchCalls = React.useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (statusFilter) params.set("status", statusFilter);
      if (languageFilter) params.set("language", languageFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/voice-calls?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setCalls(data.voiceCalls);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load voice calls");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, languageFilter, dateFrom, dateTo]);

  React.useEffect(() => { void fetchCalls(1); }, [fetchCalls]);

  const toggleExpand = async (callId: string) => {
    if (expandedId === callId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(callId);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/voice-calls/${callId}`);
      if (!res.ok) throw new Error(`Failed to load detail: ${res.status}`);
      const detail = (await res.json()) as VoiceCallDetail;
      setExpandedDetail(detail);
    } catch {
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Phone className="h-5 w-5 text-indigo-500" />
            Voice Calls
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {total} call{total !== 1 ? "s" : ""} recorded
          </p>
        </div>
        <button
          onClick={() => void fetchCalls(page)}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All statuses</option>
          <option value="RINGING">Ringing</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="MISSED">Missed</option>
          <option value="VOICEMAIL">Voicemail</option>
        </select>

        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All languages</option>
          <option value="en-IN">English (India)</option>
          <option value="hi-IN">Hindi</option>
          <option value="ta-IN">Tamil</option>
          <option value="te-IN">Telugu</option>
          <option value="mr-IN">Marathi</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="To date"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">
            Loading calls...
          </div>
        ) : calls.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">
            No voice calls found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left"></th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Intent</th>
                <th className="px-4 py-3 text-left">Language</th>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-left">Segments</th>
                <th className="px-4 py-3 text-left">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {calls.map((call) => (
                <React.Fragment key={call.id}>
                  <tr
                    onClick={() => void toggleExpand(call.id)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-400">
                      {call.direction === "INBOUND" ? (
                        <PhoneIncoming className="h-4 w-4 text-blue-500" />
                      ) : (
                        <PhoneOutgoing className="h-4 w-4 text-green-500" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {call.customer?.name ?? call.fromNumber}
                      </div>
                      {call.customer && (
                        <div className="text-xs text-gray-500">{call.fromNumber}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOURS[call.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {call.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {call.intent ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {call.language ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDuration(call.durationSeconds)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {call._count.segments}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <div className="flex items-center gap-1">
                        {formatDateTime(call.startedAt)}
                        {expandedId === call.id ? (
                          <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Segment timeline row */}
                  {expandedId === call.id && (
                    <tr>
                      <td colSpan={8} className="bg-gray-50 px-6 py-4">
                        {detailLoading ? (
                          <p className="text-sm text-gray-400">Loading segments...</p>
                        ) : !expandedDetail ? (
                          <p className="text-sm text-gray-400">No detail available.</p>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                              Conversation segments
                            </p>
                            {expandedDetail.segments.map((seg) => (
                              <div
                                key={seg.id}
                                className={`rounded-md border p-3 ${SPEAKER_COLOURS[seg.speaker] ?? "bg-white border-gray-200"}`}
                              >
                                <div className="mb-1 flex items-center gap-2">
                                  <span className="text-xs font-semibold uppercase text-gray-500">
                                    {seg.speaker}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {(seg.startMs / 1000).toFixed(1)}s
                                    {seg.endMs !== null ? ` – ${(seg.endMs / 1000).toFixed(1)}s` : ""}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-800">{seg.content}</p>
                                {seg.audioUrl && (
                                  <a
                                    href={seg.audioUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1 text-xs text-indigo-600 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Listen
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{total} total call{total !== 1 ? "s" : ""}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => void fetchCalls(page - 1)}
              className="rounded border border-gray-200 px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="rounded border border-gray-200 px-3 py-1 bg-indigo-50 text-indigo-700 font-medium">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => void fetchCalls(page + 1)}
              className="rounded border border-gray-200 px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
