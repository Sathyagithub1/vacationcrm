"use client";

/**
 * /settings/intake-forms — Intake Forms list page.
 *
 * Shows all intake forms for the tenant in a table with:
 *  - name, source, status badge, last submission time
 *  - pause / activate toggle button
 *  - "Test with last payload" replay button
 *
 * Accessible to COMPANY_ADMIN, DEPT_MANAGER (read+pause); AGENT/VIEWER blocked.
 */

import * as React from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { IntakeFormStatusBadge } from "@/components/intake/IntakeFormStatusBadge";
import { Plus, Play, PauseCircle, PlayCircle, ExternalLink } from "lucide-react";

interface IntakeForm {
  id: string;
  name: string;
  source: string;
  status: string;
  lastSubmissionAt: string | null;
  fieldMappingConfirmed: boolean;
}

interface ApiResponse {
  forms: IntakeForm[];
  total: number;
  page: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

export default function IntakeFormsListPage() {
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(true);
  const [forms, setForms]     = React.useState<IntakeForm[]>([]);
  const [total, setTotal]     = React.useState(0);
  const [page, setPage]       = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [toggling, setToggling]     = React.useState<string | null>(null);
  const [replaying, setReplaying]   = React.useState<string | null>(null);

  async function fetchForms(p: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/intake-forms?page=${p}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error("Failed to load intake forms");
      const data: ApiResponse = await res.json();
      setForms(data.forms);
      setTotal(data.total);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load intake forms");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    fetchForms(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleStatus(form: IntakeForm) {
    const nextStatus = form.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setToggling(form.id);
    try {
      const res = await fetch(`/api/intake-forms/${form.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to update status");
      }
      toast("success", `Form ${nextStatus === "ACTIVE" ? "activated" : "paused"}`);
      await fetchForms(page);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setToggling(null);
    }
  }

  async function handleReplay(form: IntakeForm) {
    setReplaying(form.id);
    try {
      const res = await fetch(`/api/intake-forms/${form.id}/test`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Replay failed");
      }
      const data = (await res.json()) as { message?: string };
      toast("success", data.message ?? "Test replay queued");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplaying(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Intake Forms</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Forms are auto-created when a new webhook source arrives.
          </p>
        </div>
        <Link href="/settings/intake-forms/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New Form
          </Button>
        </Link>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : forms.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-gray-900">No intake forms yet</p>
            <p className="mt-1 text-xs text-gray-500">
              They auto-create when a new webhook source arrives.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Submission</TableHead>
                <TableHead>Field Map</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell>
                    <Link
                      href={`/settings/intake-forms/${form.id}`}
                      className="font-medium text-primary-600 hover:underline flex items-center gap-1"
                    >
                      {form.name}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{form.source}</TableCell>
                  <TableCell>
                    <IntakeFormStatusBadge status={form.status} />
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {form.lastSubmissionAt
                      ? new Date(form.lastSubmissionAt).toLocaleString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {form.fieldMappingConfirmed ? (
                      <span className="text-xs text-green-600">Confirmed</span>
                    ) : (
                      <span className="text-xs text-yellow-600">Needs review</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReplay(form)}
                        loading={replaying === form.id}
                        title="Test with last payload"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(form)}
                        loading={toggling === form.id}
                        title={form.status === "ACTIVE" ? "Pause form" : "Activate form"}
                      >
                        {form.status === "ACTIVE" ? (
                          <>
                            <PauseCircle className="h-3.5 w-3.5" />
                            Pause
                          </>
                        ) : (
                          <>
                            <PlayCircle className="h-3.5 w-3.5" />
                            Activate
                          </>
                        )}
                      </Button>
                    </div>
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
            onPageChange={(p) => fetchForms(p)}
          />
        </div>
      )}

      <p className="text-xs text-gray-400">
        {!loading && `${total} form${total !== 1 ? "s" : ""} total`}
      </p>
    </div>
  );
}
