"use client";

import * as React from "react";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Lock,
  Save,
  Zap,
  ToggleLeft,
  ToggleRight,
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

interface FollowUpRule {
  id: string;
  triggerType: string;
  triggerValue: string | null;
  followUpType: string;
  delayHours: number;
  messageTemplate: string | null;
  isActive: boolean;
  departmentId: string | null;
  department: { id: string; name: string } | null;
}

const TRIGGER_TYPES = [
  { value: "STAGE_CHANGE", label: "Stage Change" },
  { value: "LEAD_CREATED", label: "Lead Created" },
  { value: "LEAD_INACTIVE", label: "Lead Inactive" },
];

const FOLLOW_UP_TYPES = [
  { value: "REMINDER", label: "Reminder" },
  { value: "QUOTATION", label: "Quotation" },
  { value: "DOCUMENT", label: "Document" },
  { value: "PAYMENT", label: "Payment" },
  { value: "RE_ENGAGE", label: "Re-engage" },
];

const emptyStageForm = {
  name: "",
  color: "#6B7280",
  departmentId: "",
};

const emptyRuleForm = {
  triggerType: "STAGE_CHANGE",
  triggerValue: "",
  followUpType: "REMINDER",
  delayHours: "24",
  messageTemplate: "",
  departmentId: "",
};

/* ─── Follow-Up Rules Section ─── */
function FollowUpRulesSection({
  stages,
  departments,
}: {
  stages: PipelineStage[];
  departments: Department[];
}) {
  const { toast } = useToast();
  const [rules, setRules] = React.useState<FollowUpRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(emptyRuleForm);
  const [saving, setSaving] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const fetchRules = React.useCallback(async () => {
    try {
      const res = await fetch("/api/follow-up-rules");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRules(data.rules);
    } catch {
      toast("error", "Failed to load follow-up rules");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyRuleForm);
    setModalOpen(true);
  }

  function openEdit(rule: FollowUpRule) {
    setEditingId(rule.id);
    setForm({
      triggerType: rule.triggerType,
      triggerValue: rule.triggerValue || "",
      followUpType: rule.followUpType,
      delayHours: String(rule.delayHours),
      messageTemplate: rule.messageTemplate || "",
      departmentId: rule.departmentId || "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const delayHours = Number(form.delayHours);
    if (isNaN(delayHours) || delayHours < 0) {
      toast("warning", "Delay hours must be a non-negative number");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        triggerType: form.triggerType,
        triggerValue: form.triggerValue || null,
        followUpType: form.followUpType,
        delayHours,
        messageTemplate: form.messageTemplate || null,
        departmentId: form.departmentId || null,
      };

      if (editingId) {
        payload.id = editingId;
        const res = await fetch("/api/follow-up-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update");
        }
        toast("success", "Rule updated");
      } else {
        const res = await fetch("/api/follow-up-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create");
        }
        toast("success", "Rule created");
      }

      setModalOpen(false);
      fetchRules();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule: FollowUpRule) {
    const label = TRIGGER_TYPES.find((t) => t.value === rule.triggerType)?.label || rule.triggerType;
    if (!confirm(`Delete this "${label}" rule? This cannot be undone.`)) return;

    try {
      const res = await fetch("/api/follow-up-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      toast("success", "Rule deleted");
      fetchRules();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  async function handleToggleActive(rule: FollowUpRule) {
    setTogglingId(rule.id);
    try {
      const res = await fetch("/api/follow-up-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to toggle");
      }
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r))
      );
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to toggle rule");
    } finally {
      setTogglingId(null);
    }
  }

  function triggerLabel(type: string) {
    return TRIGGER_TYPES.find((t) => t.value === type)?.label || type;
  }

  function followUpLabel(type: string) {
    return FOLLOW_UP_TYPES.find((t) => t.value === type)?.label || type;
  }

  function triggerValueLabel(rule: FollowUpRule) {
    if (rule.triggerType === "STAGE_CHANGE" && rule.triggerValue) {
      const stage = stages.find((s) => s.slug === rule.triggerValue || s.name === rule.triggerValue);
      return stage ? stage.name : rule.triggerValue;
    }
    if (rule.triggerType === "LEAD_INACTIVE" && rule.triggerValue) {
      return `${rule.triggerValue} days`;
    }
    return rule.triggerValue || "--";
  }

  // Build trigger value options based on selected trigger type
  const triggerValueOptions = React.useMemo(() => {
    if (form.triggerType === "STAGE_CHANGE") {
      return stages.map((s) => ({ value: s.slug || s.name, label: s.name }));
    }
    return [];
  }, [form.triggerType, stages]);

  const showTriggerValueSelect = form.triggerType === "STAGE_CHANGE";
  const showTriggerValueInput = form.triggerType === "LEAD_INACTIVE";

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            <Zap className="mr-1.5 inline-block h-4 w-4 text-amber-500" />
            Follow-Up Rules
          </h2>
          <p className="text-xs text-gray-500">
            Automated follow-up rules triggered by lead events.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4" />
          Add Rule
        </Button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        {rules.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            No follow-up rules configured. Add your first automation rule.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50"
              >
                {/* Active toggle */}
                <button
                  onClick={() => handleToggleActive(rule)}
                  disabled={togglingId === rule.id}
                  className="flex-shrink-0 text-gray-500 hover:text-gray-700 disabled:opacity-50"
                  title={rule.isActive ? "Active (click to disable)" : "Inactive (click to enable)"}
                >
                  {rule.isActive ? (
                    <ToggleRight className="h-5 w-5 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-5 w-5 text-gray-300" />
                  )}
                </button>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={rule.isActive ? "success" : "default"} size="sm">
                      {triggerLabel(rule.triggerType)}
                    </Badge>
                    {rule.triggerValue && (
                      <span className="text-xs text-gray-500">
                        {triggerValueLabel(rule)}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">-&gt;</span>
                    <Badge variant="info" size="sm">
                      {followUpLabel(rule.followUpType)}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      after {rule.delayHours}h
                    </span>
                  </div>
                  {(rule.messageTemplate || rule.department) && (
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                      {rule.department && (
                        <span>{rule.department.name}</span>
                      )}
                      {rule.messageTemplate && (
                        <span className="truncate max-w-xs">
                          {rule.messageTemplate}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(rule)}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule)}
                    className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Rule Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit Follow-Up Rule" : "Add Follow-Up Rule"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Trigger Type"
            value={form.triggerType}
            onChange={(e) =>
              setForm((f) => ({ ...f, triggerType: e.target.value, triggerValue: "" }))
            }
            options={TRIGGER_TYPES}
          />

          {showTriggerValueSelect && (
            <Select
              label="Trigger Stage"
              value={form.triggerValue}
              onChange={(e) => setForm((f) => ({ ...f, triggerValue: e.target.value }))}
              placeholder="Select a stage"
              options={[
                { value: "", label: "Any stage" },
                ...triggerValueOptions,
              ]}
            />
          )}

          {showTriggerValueInput && (
            <Input
              label="Inactive Days"
              type="number"
              min={1}
              value={form.triggerValue}
              onChange={(e) => setForm((f) => ({ ...f, triggerValue: e.target.value }))}
              placeholder="e.g. 7"
            />
          )}

          <Select
            label="Follow-Up Type"
            value={form.followUpType}
            onChange={(e) => setForm((f) => ({ ...f, followUpType: e.target.value }))}
            options={FOLLOW_UP_TYPES}
          />

          <Input
            label="Delay (hours)"
            type="number"
            min={0}
            value={form.delayHours}
            onChange={(e) => setForm((f) => ({ ...f, delayHours: e.target.value }))}
            placeholder="e.g. 24"
            required
          />

          <div className="w-full">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Message Template (optional)
            </label>
            <textarea
              value={form.messageTemplate}
              onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))}
              placeholder="Hi {{name}}, just following up..."
              rows={3}
              className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>

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

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingId ? "Update" : "Create"} Rule
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

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

      {/* Follow-Up Rules Section */}
      <div className="mt-10 border-t border-gray-200 pt-8">
        <FollowUpRulesSection stages={stages} departments={departments} />
      </div>
    </div>
  );
}
