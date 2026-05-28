"use client";

/**
 * /settings/intake-forms/[id] — Intake Form detail page.
 *
 * Three sections:
 *  1. Basics — name, department, default tags
 *  2. Field Map Editor — raw → canonical key mapping with confirm button
 *  3. Recent Submissions — last 10 intake webhook log entries
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { IntakeFormStatusBadge } from "@/components/intake/IntakeFormStatusBadge";
import { FieldMapEditor } from "@/components/intake/FieldMapEditor";
import { ArrowLeft } from "lucide-react";

interface IntakeFormDetail {
  id: string;
  name: string;
  source: string;
  status: string;
  departmentId: string | null;
  defaultTags: string[];
  fieldMap: Record<string, string>;
  fieldMappingConfirmed: boolean;
  lastSubmissionAt: string | null;
}

interface Department {
  id: string;
  name: string;
}

interface FieldMapData {
  fieldMap: Record<string, string>;
  confirmed: boolean;
  sample: Record<string, unknown> | null;
  sampleAt: string | null;
}

interface RecentLog {
  id: string;
  receivedAt: string;
  source: string;
  status: string;
  rawPayload: Record<string, unknown>;
}

export default function IntakeFormDetailPage() {
  const params    = useParams();
  const router    = useRouter();
  const { toast } = useToast();
  const id        = typeof params.id === "string" ? params.id : (params.id as string[])[0];

  const [loading, setLoading]   = React.useState(true);
  const [saving,  setSaving]    = React.useState(false);
  const [form,    setForm]      = React.useState<IntakeFormDetail | null>(null);
  const [depts,   setDepts]     = React.useState<Department[]>([]);
  const [fieldMapData, setFieldMapData] = React.useState<FieldMapData | null>(null);
  const [recentLogs,   setRecentLogs]   = React.useState<RecentLog[]>([]);

  // Local editable state
  const [name,       setName]       = React.useState("");
  const [deptId,     setDeptId]     = React.useState("");
  const [tagsInput,  setTagsInput]  = React.useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [formRes, fieldRes, deptRes] = await Promise.all([
        fetch(`/api/intake-forms/${id}`),
        fetch(`/api/intake-forms/${id}/field-map`),
        fetch("/api/departments?limit=100"),
      ]);

      if (!formRes.ok) throw new Error("Intake form not found");

      const formData: { form: IntakeFormDetail } = await formRes.json();
      const fm: FieldMapData = fieldRes.ok ? await fieldRes.json() : { fieldMap: {}, confirmed: false, sample: null, sampleAt: null };
      const deptData: { departments?: Department[] } = deptRes.ok ? await deptRes.json() : {};

      setForm(formData.form);
      setName(formData.form.name);
      setDeptId(formData.form.departmentId ?? "");
      setTagsInput((formData.form.defaultTags ?? []).join(", "));
      setFieldMapData(fm);
      setDepts(deptData.departments ?? []);

      // Fetch recent logs (last 10)
      const logsRes = await fetch(`/api/intake-forms/${id}?includeRecentLogs=true`);
      if (logsRes.ok) {
        const logsData: { recentLogs?: RecentLog[] } = await logsRes.json();
        setRecentLogs(logsData.recentLogs ?? []);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load form");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSaveBasics() {
    if (!name.trim()) {
      toast("error", "Name is required");
      return;
    }
    setSaving(true);
    try {
      const defaultTags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`/api/intake-forms/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name,
          departmentId: deptId || null,
          defaultTags,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      toast("success", "Intake form updated");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">
        Intake form not found.
      </div>
    );
  }

  const deptOptions = [
    { value: "", label: "— No department —" },
    ...depts.map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <div className="max-w-3xl space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/settings/intake-forms")}
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{form.name}</h2>
            <IntakeFormStatusBadge status={form.status} />
          </div>
          <p className="mt-0.5 text-xs text-gray-500 font-mono">source: {form.source}</p>
        </div>
      </div>

      {/* Section 1 — Basics */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Basics</h3>

        <Input
          label="Form Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. WhatsApp Lead Form"
        />

        <Select
          label="Default Department"
          options={deptOptions}
          value={deptId}
          onChange={(e) => setDeptId(e.target.value)}
        />

        <Input
          label="Default Tags (comma separated)"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="e.g. whatsapp, hot-lead, SEA"
        />

        <div className="flex justify-end">
          <Button onClick={handleSaveBasics} loading={saving}>
            Save Basics
          </Button>
        </div>
      </div>

      {/* Section 2 — Field Map Editor */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Field Mapping</h3>
          {fieldMapData?.sampleAt && (
            <span className="text-xs text-gray-400">
              Sample from {new Date(fieldMapData.sampleAt).toLocaleString()}
            </span>
          )}
        </div>

        {fieldMapData ? (
          <FieldMapEditor
            formId={id}
            initialMap={fieldMapData.fieldMap ?? {}}
            sample={fieldMapData.sample}
            onSaved={loadAll}
          />
        ) : (
          <div className="py-6 text-center text-sm text-gray-400">
            Field map data unavailable.
          </div>
        )}
      </div>

      {/* Section 3 — Recent Submissions */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Recent Submissions</h3>

        {recentLogs.length === 0 ? (
          <p className="text-sm text-gray-400">No submissions yet.</p>
        ) : (
          <div className="overflow-hidden rounded border border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Received At</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Payload preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(log.receivedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 capitalize text-gray-600">{log.status}</td>
                    <td className="px-3 py-2 font-mono text-gray-500 truncate max-w-xs">
                      {JSON.stringify(log.rawPayload).slice(0, 80)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
