"use client";

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Lock,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ui/color-picker";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/loading";
import { useToast } from "@/components/ui/toast";

interface PipelineStage {
  id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  isDefault: boolean;
  isSystem: boolean;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  _count: { leads: number };
}

interface Department {
  id: string;
  name: string;
}

const emptyStageForm = {
  name: "",
  color: "#6B7280",
  departmentId: "",
};

export default function PipelineSettingsPage() {
  const { toast } = useToast();
  const [stages, setStages] = React.useState<PipelineStage[]>([]);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(emptyStageForm);
  const [saving, setSaving] = React.useState(false);
  const [orderChanged, setOrderChanged] = React.useState(false);
  const [savingOrder, setSavingOrder] = React.useState(false);

  // Drag state
  const dragItem = React.useRef<number | null>(null);
  const dragOverItem = React.useRef<number | null>(null);

  const fetchStages = React.useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline-stages");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setStages(data.stages);
    } catch {
      toast("error", "Failed to load pipeline stages");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchDepartments = React.useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (!res.ok) return;
      const data = await res.json();
      setDepartments(data.departments.filter((d: Department & { isActive: boolean }) => d.isActive !== false));
    } catch {
      // non-critical
    }
  }, []);

  React.useEffect(() => {
    fetchStages();
    fetchDepartments();
  }, [fetchStages, fetchDepartments]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyStageForm);
    setModalOpen(true);
  }

  function openEdit(stage: PipelineStage) {
    setEditingId(stage.id);
    setForm({
      name: stage.name,
      color: stage.color,
      departmentId: stage.departmentId || "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId && !form.name.trim()) {
      toast("warning", "Name is required");
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `/api/pipeline-stages/${editingId}` : "/api/pipeline-stages";
      const method = editingId ? "PUT" : "POST";

      const body: Record<string, unknown> = {};
      if (editingId) {
        // For edit, only send changed fields
        const existing = stages.find((s) => s.id === editingId);
        if (existing?.isSystem) {
          // System stages: only color
          body.color = form.color;
        } else {
          body.name = form.name;
          body.color = form.color;
        }
      } else {
        body.name = form.name;
        body.color = form.color;
        if (form.departmentId) body.departmentId = form.departmentId;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", editingId ? "Stage updated" : "Stage created");
      setModalOpen(false);
      fetchStages();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save stage");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(stage: PipelineStage) {
    if (!confirm(`Delete stage "${stage.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/pipeline-stages/${stage.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      toast("success", `Stage "${stage.name}" deleted`);
      fetchStages();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete stage");
    }
  }

  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) return;

    const reordered = [...stages];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);

    // Update positions
    const updated = reordered.map((s, i) => ({ ...s, position: i }));
    setStages(updated);
    setOrderChanged(true);

    dragItem.current = null;
    dragOverItem.current = null;
  }

  async function handleSaveOrder() {
    setSavingOrder(true);
    try {
      // Update each stage position
      const updates = stages.map((stage, index) =>
        fetch(`/api/pipeline-stages/${stage.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: index }),
        })
      );

      const results = await Promise.all(updates);
      const failed = results.filter((r) => !r.ok);

      if (failed.length > 0) {
        throw new Error("Some stages failed to update");
      }

      toast("success", "Stage order saved");
      setOrderChanged(false);
      fetchStages();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save order");
    } finally {
      setSavingOrder(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isSystemStage = editingId ? stages.find((s) => s.id === editingId)?.isSystem : false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Pipeline Stages</h2>
          <p className="text-xs text-gray-500">
            Define the stages leads move through. Drag to reorder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {orderChanged && (
            <Button onClick={handleSaveOrder} loading={savingOrder} variant="secondary" size="sm">
              <Save className="h-4 w-4" />
              Save Order
            </Button>
          )}
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4" />
            Add Stage
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        {stages.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            No pipeline stages configured. Add your first stage.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {stages.map((stage, index) => (
              <div
                key={stage.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50 cursor-grab active:cursor-grabbing"
              >
                {/* Drag handle */}
                <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-300" />

                {/* Color swatch */}
                <div
                  className="h-6 w-6 flex-shrink-0 rounded-full border border-gray-200"
                  style={{ backgroundColor: stage.color }}
                />

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{stage.name}</span>
                    {stage.isSystem && (
                      <Badge variant="info" size="sm">
                        <Lock className="mr-1 h-3 w-3" />
                        System
                      </Badge>
                    )}
                    {stage.isDefault && (
                      <Badge variant="primary" size="sm">Default</Badge>
                    )}
                  </div>
                  {stage.department && (
                    <p className="text-xs text-gray-500">{stage.department.name}</p>
                  )}
                </div>

                {/* Lead count */}
                <span className="text-xs text-gray-400">
                  {stage._count.leads} {stage._count.leads === 1 ? "lead" : "leads"}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(stage)}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(stage)}
                    disabled={stage.isSystem}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                    title={stage.isSystem ? "System stages cannot be deleted" : "Delete"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Stage" : "Add Stage"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSystemStage && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              System stages can only change their color.
            </div>
          )}

          <Input
            label="Stage Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Proposal Sent"
            disabled={!!isSystemStage}
            required={!isSystemStage}
          />

          <ColorPicker
            label="Color"
            value={form.color}
            onChange={(color) => setForm((f) => ({ ...f, color }))}
            presets={[
              "#6B7280", "#3B82F6", "#10B981", "#F59E0B",
              "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6",
            ]}
          />

          {!editingId && (
            <Select
              label="Department (optional)"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
              placeholder="All departments"
              options={[
                { value: "", label: "All departments" },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingId ? "Update" : "Create"} Stage
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
