"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import {
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  Copy,
  Check,
  Monitor,
} from "lucide-react";

interface QuickAction {
  label: string;
  message: string;
}

interface BusinessHour {
  day: string;
  enabled: boolean;
  open: string;
  close: string;
}

interface WidgetConfig {
  id?: string;
  departmentId: string;
  departmentName?: string;
  welcomeMessage: string;
  quickActions: QuickAction[];
  position: "bottom-right" | "bottom-left";
  autoOpenDelay: number;
  maxConcurrentVisitors: number;
  offlineMessage: string;
  businessHours: BusinessHour[];
}

interface Department {
  id: string;
  name: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const defaultBusinessHours: BusinessHour[] = DAYS.map((day) => ({
  day,
  enabled: !["Saturday", "Sunday"].includes(day),
  open: "09:00",
  close: "18:00",
}));

const defaultConfig: Omit<WidgetConfig, "departmentId"> = {
  welcomeMessage: "Hi there! How can we help you today?",
  quickActions: [],
  position: "bottom-right",
  autoOpenDelay: 0,
  maxConcurrentVisitors: 50,
  offlineMessage: "We are currently offline. Please leave a message and we will get back to you.",
  businessHours: defaultBusinessHours,
};

export default function WidgetSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [configs, setConfigs] = React.useState<WidgetConfig[]>([]);
  const [selectedDeptId, setSelectedDeptId] = React.useState("");
  const [form, setForm] = React.useState<WidgetConfig | null>(null);

  // Quick action editor
  const [editingQaIndex, setEditingQaIndex] = React.useState<number | null>(null);
  const [qaLabel, setQaLabel] = React.useState("");
  const [qaMessage, setQaMessage] = React.useState("");

  // Embed code copy
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [widgetRes, deptRes] = await Promise.all([
          fetch("/api/widget-configs").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/departments").then((r) => (r.ok ? r.json() : null)),
        ]);
        const depts: Department[] = deptRes?.departments || [];
        setDepartments(depts);

        const cfgs: WidgetConfig[] = widgetRes?.configs || [];
        setConfigs(cfgs);

        if (depts.length > 0) {
          const firstId = depts[0].id;
          setSelectedDeptId(firstId);
          const existing = cfgs.find((c) => c.departmentId === firstId);
          setForm(existing || { ...defaultConfig, departmentId: firstId });
        }
      } catch {
        toast("error", "Failed to load widget settings");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [toast]);

  function handleDeptChange(deptId: string) {
    setSelectedDeptId(deptId);
    const existing = configs.find((c) => c.departmentId === deptId);
    setForm(existing || { ...defaultConfig, departmentId: deptId, businessHours: [...defaultBusinessHours] });
    setEditingQaIndex(null);
  }

  function addQuickAction() {
    if (!qaLabel.trim() || !qaMessage.trim()) {
      toast("error", "Both label and message are required");
      return;
    }
    if (!form) return;

    if (editingQaIndex !== null) {
      const updated = [...form.quickActions];
      updated[editingQaIndex] = { label: qaLabel, message: qaMessage };
      setForm({ ...form, quickActions: updated });
      setEditingQaIndex(null);
    } else {
      setForm({ ...form, quickActions: [...form.quickActions, { label: qaLabel, message: qaMessage }] });
    }
    setQaLabel("");
    setQaMessage("");
  }

  function editQuickAction(idx: number) {
    if (!form) return;
    const qa = form.quickActions[idx];
    setQaLabel(qa.label);
    setQaMessage(qa.message);
    setEditingQaIndex(idx);
  }

  function removeQuickAction(idx: number) {
    if (!form) return;
    setForm({ ...form, quickActions: form.quickActions.filter((_, i) => i !== idx) });
    if (editingQaIndex === idx) {
      setEditingQaIndex(null);
      setQaLabel("");
      setQaMessage("");
    }
  }

  function updateBusinessHour(idx: number, key: keyof BusinessHour, value: string | boolean) {
    if (!form) return;
    const updated = [...form.businessHours];
    updated[idx] = { ...updated[idx], [key]: value };
    setForm({ ...form, businessHours: updated });
  }

  async function handleSave() {
    if (!form) return;

    setSaving(true);
    try {
      const method = form.id ? "PUT" : "POST";
      const url = form.id ? `/api/widget-configs/${form.id}` : "/api/widget-configs";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const saved = await res.json();
      const savedConfig = saved.config;

      setConfigs((prev) => {
        const idx = prev.findIndex((c) => c.departmentId === savedConfig.departmentId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = savedConfig;
          return updated;
        }
        return [...prev, savedConfig];
      });
      setForm(savedConfig);
      toast("success", "Widget settings saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function getEmbedCode(): string {
    if (!form?.id) return "<!-- Save the widget configuration first to generate embed code -->";
    const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";
    return `<script src="${origin}/widget.js" data-widget-id="${form.id}" async></script>`;
  }

  function copyEmbedCode() {
    navigator.clipboard.writeText(getEmbedCode()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (departments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Monitor className="mb-2 h-10 w-10" />
        <p className="text-sm">Create a department first to configure the widget.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Department selector */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <Select
          label="Department"
          options={departments.map((d) => ({ label: d.name, value: d.id }))}
          value={selectedDeptId}
          onChange={(e) => handleDeptChange(e.target.value)}
        />
      </div>

      {form && (
        <>
          {/* Welcome & offline messages */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Messages</h2>
            <div className="space-y-4">
              <div className="w-full">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Welcome Message
                </label>
                <textarea
                  value={form.welcomeMessage}
                  onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                  rows={3}
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div className="w-full">
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Offline Message
                </label>
                <textarea
                  value={form.offlineMessage}
                  onChange={(e) => setForm({ ...form, offlineMessage: e.target.value })}
                  rows={3}
                  className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Quick Actions</h2>

            {form.quickActions.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {form.quickActions.map((qa, idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm"
                  >
                    <span className="text-gray-700">{qa.label}</span>
                    <button
                      onClick={() => editQuickAction(idx)}
                      className="rounded p-0.5 text-gray-400 hover:text-gray-600"
                      aria-label="Edit quick action"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => removeQuickAction(idx)}
                      className="rounded p-0.5 text-gray-400 hover:text-red-500"
                      aria-label="Remove quick action"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={qaLabel}
                onChange={(e) => setQaLabel(e.target.value)}
                placeholder="Button label"
                className="flex-1"
              />
              <Input
                value={qaMessage}
                onChange={(e) => setQaMessage(e.target.value)}
                placeholder="Message to send"
                className="flex-1"
              />
              <Button size="sm" onClick={addQuickAction} variant="secondary">
                {editingQaIndex !== null ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Appearance & Behavior */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Appearance &amp; Behavior</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Widget Position</label>
                <div className="flex rounded-md border border-gray-300">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, position: "bottom-right" })}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.position === "bottom-right"
                        ? "bg-primary-500 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    } rounded-l-md`}
                  >
                    Bottom Right
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, position: "bottom-left" })}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.position === "bottom-left"
                        ? "bg-primary-500 text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    } rounded-r-md`}
                  >
                    Bottom Left
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Auto-open Delay: {form.autoOpenDelay}s
                </label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={form.autoOpenDelay}
                  onChange={(e) =>
                    setForm({ ...form, autoOpenDelay: parseInt(e.target.value) })
                  }
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary-500"
                />
                <div className="mt-1 flex justify-between text-xs text-gray-400">
                  <span>Off (0s)</span>
                  <span>10s</span>
                </div>
              </div>

              <Input
                label="Max Concurrent Visitors"
                type="number"
                value={String(form.maxConcurrentVisitors)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    maxConcurrentVisitors: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="50"
              />
            </div>
          </div>

          {/* Business Hours */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Business Hours</h2>
            <div className="space-y-2">
              {form.businessHours.map((bh, idx) => (
                <div key={bh.day} className="flex items-center gap-3">
                  <div className="w-24">
                    <label className="text-sm text-gray-700">{bh.day}</label>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={bh.enabled}
                    aria-label={`Toggle ${bh.day}`}
                    onClick={() => updateBusinessHour(idx, "enabled", !bh.enabled)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      bh.enabled ? "bg-primary-500" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${
                        bh.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  {bh.enabled ? (
                    <>
                      <input
                        type="time"
                        value={bh.open}
                        onChange={(e) => updateBusinessHour(idx, "open", e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                      <span className="text-xs text-gray-400">to</span>
                      <input
                        type="time"
                        value={bh.close}
                        onChange={(e) => updateBusinessHour(idx, "close", e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                      />
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">Closed</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Embed Code */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Embed Code</h2>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <code className="flex-1 truncate text-xs text-gray-600">{getEmbedCode()}</code>
              <button
                type="button"
                onClick={copyEmbedCode}
                className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                aria-label="Copy embed code"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Widget Preview */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Preview</h2>
            <div className="relative h-64 rounded-md border border-gray-200 bg-gray-50">
              {/* Preview bubble */}
              <div
                className={`absolute bottom-4 ${
                  form.position === "bottom-right" ? "right-4" : "left-4"
                }`}
              >
                <div className="mb-2 w-64 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
                  <p className="mb-3 text-sm text-gray-700">{form.welcomeMessage}</p>
                  {form.quickActions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {form.quickActions.map((qa, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs text-primary-700"
                        >
                          {qa.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 shadow-lg">
                  <MessageSquare className="h-6 w-6 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pb-8">
            <Button onClick={handleSave} loading={saving}>
              Save Widget Settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
