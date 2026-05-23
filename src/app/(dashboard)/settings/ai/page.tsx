"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { Eye, EyeOff, Brain, Trash2, Plus } from "lucide-react";

interface AiProvider {
  id?: string;
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  active: boolean;
}

interface AiMetrics {
  totalRequests: number;
  avgLatencyMs: number;
  successRate: number;
  tokensUsed: number;
}

const PROVIDER_OPTIONS = [
  { label: "Claude (Anthropic)", value: "CLAUDE" },
  { label: "OpenAI", value: "OPENAI" },
  { label: "Gemini (Google)", value: "GEMINI" },
];

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  CLAUDE: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
  OPENAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  GEMINI: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
};

const defaultForm: AiProvider = {
  provider: "CLAUDE",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 2048,
  active: true,
};

export default function AiSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [providers, setProviders] = React.useState<AiProvider[]>([]);
  const [metrics, setMetrics] = React.useState<AiMetrics | null>(null);
  const [form, setForm] = React.useState<AiProvider>(defaultForm);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [showSuggestions, setShowSuggestions] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [providersRes, metricsRes] = await Promise.all([
          fetch("/api/ai/providers").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/ai/metrics").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (providersRes?.providers) setProviders(providersRes.providers);
        if (metricsRes) setMetrics(metricsRes);
      } catch {
        toast("error", "Failed to load AI configuration");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [toast]);

  function handleEdit(provider: AiProvider) {
    setForm({ ...provider, apiKey: "" });
    setEditingId(provider.id || null);
    setShowApiKey(false);
  }

  function handleCancelEdit() {
    setForm(defaultForm);
    setEditingId(null);
    setShowApiKey(false);
  }

  async function handleSave() {
    if (!form.apiKey && !editingId) {
      toast("error", "API Key is required");
      return;
    }
    if (!form.model.trim()) {
      toast("error", "Model name is required");
      return;
    }

    setSaving(true);
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `/api/ai/providers/${editingId}` : "/api/ai/providers";
      const body: Record<string, unknown> = {
        provider: form.provider,
        model: form.model,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        active: form.active,
      };
      if (form.apiKey) body.apiKey = form.apiKey;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const saved = await res.json();

      if (editingId) {
        setProviders((prev) => prev.map((p) => (p.id === editingId ? saved.provider : p)));
      } else {
        setProviders((prev) => [...prev, saved.provider]);
      }

      setForm(defaultForm);
      setEditingId(null);
      setShowApiKey(false);
      toast("success", editingId ? "Provider updated" : "Provider added");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this AI provider configuration?")) return;
    try {
      const res = await fetch(`/api/ai/providers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setProviders((prev) => prev.filter((p) => p.id !== id));
      if (editingId === id) handleCancelEdit();
      toast("success", "Provider deleted");
    } catch {
      toast("error", "Failed to delete provider");
    }
  }

  const suggestions = MODEL_SUGGESTIONS[form.provider] || [];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Existing providers */}
      {providers.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Configured Providers</h2>
          <div className="space-y-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Brain className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {PROVIDER_OPTIONS.find((o) => o.value === p.provider)?.label || p.provider}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.model} &middot; temp {p.temperature} &middot; max {p.maxTokens} tokens
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.active ? "success" : "default"}>
                    {p.active ? "Active" : "Inactive"}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(p)}>
                    Edit
                  </Button>
                  <button
                    onClick={() => handleDelete(p.id!)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="Delete provider"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit form */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <Brain className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">
            {editingId ? "Edit Provider" : "Add AI Provider"}
          </h2>
        </div>

        <div className="space-y-4">
          <Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={form.provider}
            onChange={(e) =>
              setForm((f) => ({ ...f, provider: e.target.value, model: "" }))
            }
          />

          <div className="relative">
            <Input
              label="API Key"
              type={showApiKey ? "text" : "password"}
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={editingId ? "Leave blank to keep existing key" : "Enter API key"}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-9 text-gray-400 hover:text-gray-600"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="relative">
            <Input
              label="Model Name"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    onMouseDown={() => setForm((f) => ({ ...f, model: s }))}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Temperature: {form.temperature}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={form.temperature}
              onChange={(e) =>
                setForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))
              }
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary-500"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>Precise (0)</span>
              <span>Creative (1)</span>
            </div>
          </div>

          <Input
            label="Max Tokens"
            type="number"
            value={String(form.maxTokens)}
            onChange={(e) =>
              setForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) || 0 }))
            }
            placeholder="2048"
          />

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Active</label>
            <button
              type="button"
              role="switch"
              aria-checked={form.active}
              onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                form.active ? "bg-primary-500" : "bg-gray-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                  form.active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          {editingId && (
            <Button variant="secondary" onClick={handleCancelEdit}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSave} loading={saving}>
            {editingId ? "Update Provider" : "Add Provider"}
          </Button>
        </div>
      </div>

      {/* Metrics card */}
      {metrics && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Provider Metrics</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Total Requests</p>
              <p className="text-lg font-semibold text-gray-900">
                {metrics.totalRequests.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Avg Latency</p>
              <p className="text-lg font-semibold text-gray-900">
                {metrics.avgLatencyMs > 0 ? `${metrics.avgLatencyMs}ms` : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Success Rate</p>
              <p className="text-lg font-semibold text-gray-900">
                {metrics.successRate > 0
                  ? `${(metrics.successRate * 100).toFixed(1)}%`
                  : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tokens Used</p>
              <p className="text-lg font-semibold text-gray-900">
                {metrics.tokensUsed > 0 ? metrics.tokensUsed.toLocaleString() : "\u2014"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
