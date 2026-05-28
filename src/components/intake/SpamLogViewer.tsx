"use client";

/**
 * SpamLogViewer
 *
 * Paginated spam log viewer with date range + channel filters.
 * Fetches from GET /api/spam-logs with query params.
 *
 * Props: none (self-contained)
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Search } from "lucide-react";

interface SpamLog {
  id: string;
  identifier: string;
  channel: string | null;
  ruleType: string;
  blockedAt: string;
  reason: string | null;
}

interface ApiResponse {
  logs: SpamLog[];
  total: number;
  page: number;
  totalPages: number;
}

const CHANNEL_OPTIONS = [
  { value: "",          label: "All channels"  },
  { value: "whatsapp",  label: "WhatsApp"      },
  { value: "email",     label: "Email"         },
  { value: "instagram", label: "Instagram"     },
  { value: "facebook",  label: "Facebook"      },
  { value: "website",   label: "Website"       },
];

const RULE_TYPE_BADGE: Record<string, "danger" | "warning" | "info" | "default"> = {
  BLACKLIST:  "danger",
  RATE_LIMIT: "warning",
  PATTERN:    "info",
  AI:         "default",
};

const PAGE_SIZE = 25;

export function SpamLogViewer() {
  const [loading,    setLoading]    = React.useState(false);
  const [logs,       setLogs]       = React.useState<SpamLog[]>([]);
  const [total,      setTotal]      = React.useState(0);
  const [page,       setPage]       = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);

  // Filters
  const [channel,   setChannel]   = React.useState("");
  const [dateFrom,  setDateFrom]  = React.useState("");
  const [dateTo,    setDateTo]    = React.useState("");

  async function fetchLogs(p: number) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page:  String(p),
        limit: String(PAGE_SIZE),
      });
      if (channel)  params.set("channel",  channel);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo)   params.set("dateTo",   dateTo);

      const res = await fetch(`/api/spam-logs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load spam logs");
      const data: ApiResponse = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch {
      // Error handled silently; UI shows empty state
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchLogs(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    fetchLogs(1);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          options={CHANNEL_OPTIONS}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="w-40"
        />
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-36"
          placeholder="From date"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-36"
          placeholder="To date"
        />
        <Button size="sm" variant="secondary" onClick={handleSearch}>
          <Search className="h-4 w-4" />
          Search
        </Button>
        {total > 0 && (
          <span className="text-xs text-gray-400">{total} log entries</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-gray-900">No spam events found</p>
            <p className="mt-1 text-xs text-gray-500">
              Adjust filters or wait for the first blocked submission.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Identifier</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Rule Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Blocked At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs">{log.identifier}</TableCell>
                  <TableCell className="capitalize text-xs">{log.channel ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={RULE_TYPE_BADGE[log.ruleType] ?? "default"}>
                      {log.ruleType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 max-w-xs truncate">
                    {log.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {new Date(log.blockedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={(p) => fetchLogs(p)}
          />
        </div>
      )}
    </div>
  );
}
