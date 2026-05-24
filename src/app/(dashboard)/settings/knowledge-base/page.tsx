"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { BookOpen, Plus, Pencil, Trash2, Upload } from "lucide-react";

interface KbEntry {
  id: string;
  departmentId: string | null;
  departmentName?: string;
  type: string;
  title: string;
  content: string;
  createdAt: string;
}

interface Department {
  id: string;
  name: string;
}

const KB_TYPES = [
  { label: "All Types", value: "" },
  { label: "FAQ", value: "FAQ" },
  { label: "SOP", value: "SOP" },
  { label: "Pricing", value: "PRICING" },
  { label: "Document", value: "DOCUMENT" },
  { label: "Custom", value: "CUSTOM" },
];

const KB_TYPE_OPTIONS = KB_TYPES.filter((t) => t.value !== "");

const TYPE_BADGE_VARIANT: Record<string, "primary" | "success" | "warning" | "info" | "default"> = {
  FAQ: "info",
  SOP: "primary",
  PRICING: "warning",
  DOCUMENT: "success",
  CUSTOM: "default",
};

const emptyForm = { departmentId: "", type: "FAQ", title: "", content: "" };

export default function KnowledgeBasePage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [entries, setEntries] = React.useState<KbEntry[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);

  // Filters
  const [filterDept, setFilterDept] = React.useState("");
  const [filterType, setFilterType] = React.useState("");

  // Add/Edit modal
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(emptyForm);

  // Import modal
  const [importOpen, setImportOpen] = React.useState(false);
  const [importJson, setImportJson] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [kbRes, deptRes] = await Promise.all([
          fetch("/api/knowledge-base").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/departments").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (kbRes?.entries) setEntries(kbRes.entries);
        if (deptRes?.departments) setDepartments(deptRes.departments);
      } catch {
        toast("error", "Failed to load knowledge base");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [toast]);

  const deptOptions = [
    { label: "All Departments", value: "" },
    ...departments.map((d) => ({ label: d.name, value: d.id })),
  ];

  // Note: "Global (all departments)" is excluded from the form because
  // the knowledge-base POST API requires a non-null departmentId.
  // When global KB support is added to the backend, restore this option.
  const deptFormOptions = [
    ...departments.map((d) => ({ label: d.name, value: d.id })),
  ];

  const filtered = entries.filter((e) => {
    if (filterDept && e.departmentId !== filterDept) return false;
    if (filterType && e.type !== filterType) return false;
    return true;
  });

  function openAddModal() {
    // Default to first department since Global option is no longer available
    setForm({ ...emptyForm, departmentId: departments[0]?.id || "" });
    setEditingId(null);
    setModalOpen(true);
  }

  function openEditModal(entry: KbEntry) {
    setForm({
      departmentId: entry.departmentId || "",
      type: entry.type,
      title: entry.title,
      content: entry.content,
    });
    setEditingId(entry.id);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.departmentId) {
      toast("error", "Department is required");
      return;
    }
    if (!form.title.trim()) {
      toast("error", "Title is required");
      return;
    }
    if (!form.content.trim()) {
      toast("error", "Content is required");
      return;
    }

    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `/api/knowledge-base/${editingId}` : "/api/knowledge-base";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: form.departmentId || null,
          type: form.type,
          title: form.title,
          content: form.content,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const saved = await res.json();

      if (editingId) {
        setEntries((prev) => prev.map((e) => (e.id === editingId ? saved.entry : e)));
      } else {
        setEntries((prev) => [...prev, saved.entry]);
      }

      setModalOpen(false);
      toast("success", editingId ? "Entry updated" : "Entry added");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this knowledge base entry?")) return;
    try {
      const res = await fetch(`/api/knowledge-base/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast("success", "Entry deleted");
    } catch {
      toast("error", "Failed to delete entry");
    }
  }

  async function handleImport() {
    if (!importJson.trim()) {
      toast("error", "Paste JSON data to import");
      return;
    }

    let parsed: unknown[];
    try {
      parsed = JSON.parse(importJson);
      if (!Array.isArray(parsed)) throw new Error("Must be an array");
    } catch {
      toast("error", "Invalid JSON. Must be an array of entries.");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/knowledge-base/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: parsed }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }

      const data = await res.json();
      if (data.entries) setEntries((prev) => [...prev, ...data.entries]);
      setImportOpen(false);
      setImportJson("");
      toast("success", `Imported ${data.count || parsed.length} entries`);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportJson((ev.target?.result as string) || "");
    };
    reader.readAsText(file);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          options={deptOptions}
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="w-48"
        />
        <Select
          options={KB_TYPES}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-40"
        />
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
          <Button size="sm" onClick={openAddModal}>
            <Plus className="h-4 w-4" />
            Add Entry
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-gray-400">
                  <BookOpen className="mx-auto mb-2 h-8 w-8" />
                  No entries found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium text-gray-900">{entry.title}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_BADGE_VARIANT[entry.type] || "default"}>
                      {entry.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {entry.departmentName || "Global"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEditModal(entry)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Edit entry"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Entry" : "Add Entry"}
      >
        <div className="space-y-4">
          <Select
            label="Department"
            options={deptFormOptions}
            value={form.departmentId}
            onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
          />
          <Select
            label="Type"
            options={KB_TYPE_OPTIONS}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          />
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Entry title"
          />
          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Content</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder="Entry content..."
              rows={6}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingId ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import Knowledge Base">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Upload a JSON file or paste JSON content. Format: array of objects with{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">type</code>,{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">title</code>, and{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">content</code> fields.
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Upload JSON File
            </label>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-primary-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
            />
          </div>
          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Or Paste JSON
            </label>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='[{"type": "FAQ", "title": "...", "content": "..."}]'
              rows={8}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} loading={importing}>
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
