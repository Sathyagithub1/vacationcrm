"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/loading";
import { BarChart3, RotateCcw } from "lucide-react";

interface ScoringWeight {
  category: string;
  weight: number;
  autoTuned: boolean;
}

interface PredictionAccuracy {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  lastTrainedAt: string | null;
}

interface AnalyticsSettings {
  autoAssignByMl: boolean;
  enableAiFollowUp: boolean;
  minConfidenceThreshold: number;
  scoringWeights: ScoringWeight[];
}

const DEFAULT_WEIGHTS: ScoringWeight[] = [
  { category: "Engagement", weight: 0.3, autoTuned: false },
  { category: "Attribute", weight: 0.25, autoTuned: false },
  { category: "Historical", weight: 0.25, autoTuned: false },
  { category: "Conversation", weight: 0.2, autoTuned: false },
];

const DEFAULT_SETTINGS: AnalyticsSettings = {
  autoAssignByMl: false,
  enableAiFollowUp: false,
  minConfidenceThreshold: 0.7,
  scoringWeights: DEFAULT_WEIGHTS,
};

export default function AnalyticsSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [settings, setSettings] = React.useState<AnalyticsSettings>(DEFAULT_SETTINGS);
  const [accuracy, setAccuracy] = React.useState<PredictionAccuracy | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [settingsRes, accuracyRes] = await Promise.all([
          fetch("/api/analytics/settings").then((r) => (r.ok ? r.json() : null)),
          fetch("/api/analytics/prediction-accuracy").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (settingsRes?.settings) setSettings(settingsRes.settings);
        // API wraps accuracy under { accuracy: {...} }
        if (accuracyRes?.accuracy) setAccuracy(accuracyRes.accuracy);
      } catch {
        toast("error", "Failed to load analytics settings");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [toast]);

  function updateWeight(idx: number, value: string) {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 1) return;
    const updated = [...settings.scoringWeights];
    updated[idx] = { ...updated[idx], weight: num, autoTuned: false };
    setSettings({ ...settings, scoringWeights: updated });
  }

  async function handleReset() {
    const defaults: AnalyticsSettings = { ...DEFAULT_SETTINGS };
    setSettings(defaults);
    try {
      const res = await fetch("/api/analytics/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });
      if (res.ok) {
        toast("info", "Settings reset to defaults");
      } else {
        toast("warning", "Reset locally — save to persist");
      }
    } catch {
      toast("warning", "Reset locally — save to persist");
    }
  }

  async function handleSave() {
    // Validate weights sum to ~1
    const totalWeight = settings.scoringWeights.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(totalWeight - 1) > 0.05) {
      toast("error", `Scoring weights must sum to 1.0 (current: ${totalWeight.toFixed(2)})`);
      return;
    }

    setSaving(true);
    try {
      // Settings API only accepts the toggle/threshold fields — scoringWeights managed separately
      const res = await fetch("/api/analytics/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoAssignByMl: settings.autoAssignByMl,
          enableAiFollowUp: settings.enableAiFollowUp,
          minConfidenceThreshold: settings.minConfidenceThreshold,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      toast("success", "Analytics settings saved");
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

  const totalWeight = settings.scoringWeights.reduce((sum, w) => sum + w.weight, 0);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Toggles */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">AI Features</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                Auto-assign leads by ML recommendation
              </p>
              <p className="text-xs text-gray-500">
                Automatically assign incoming leads to agents based on ML scoring
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoAssignByMl}
              onClick={() =>
                setSettings({ ...settings, autoAssignByMl: !settings.autoAssignByMl })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.autoAssignByMl ? "bg-primary-500" : "bg-gray-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                  settings.autoAssignByMl ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="border-t border-gray-100 pt-4" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">
                Enable AI follow-up suggestions
              </p>
              <p className="text-xs text-gray-500">
                Show AI-generated follow-up suggestions for agents in conversations
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enableAiFollowUp}
              onClick={() =>
                setSettings({ ...settings, enableAiFollowUp: !settings.enableAiFollowUp })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.enableAiFollowUp ? "bg-primary-500" : "bg-gray-200"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
                  settings.enableAiFollowUp ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Confidence threshold */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Confidence Threshold</h2>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Minimum confidence: {(settings.minConfidenceThreshold * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.minConfidenceThreshold}
            onChange={(e) =>
              setSettings({
                ...settings,
                minConfidenceThreshold: parseFloat(e.target.value),
              })
            }
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary-500"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            AI predictions below this threshold will not be shown to agents.
          </p>
        </div>
      </div>

      {/* Scoring Weights */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Scoring Weights</h2>
          <span
            className={`text-xs font-medium ${
              Math.abs(totalWeight - 1) > 0.05 ? "text-red-500" : "text-green-600"
            }`}
          >
            Total: {totalWeight.toFixed(2)}
          </span>
        </div>

        <div className="space-y-3">
          {settings.scoringWeights.map((sw, idx) => (
            <div key={sw.category} className="flex items-center gap-3">
              <span className="w-28 text-sm font-medium text-gray-700">{sw.category}</span>
              <Input
                type="number"
                value={String(sw.weight)}
                onChange={(e) => updateWeight(idx, e.target.value)}
                className="w-24"
                min={0}
                max={1}
                step={0.05}
              />
              {sw.autoTuned && (
                <Badge variant="info" size="sm">
                  Auto-tuned
                </Badge>
              )}
            </div>
          ))}
        </div>

        {Math.abs(totalWeight - 1) > 0.05 && (
          <p className="mt-3 text-xs text-red-500">
            Weights must sum to 1.0. Current total: {totalWeight.toFixed(2)}
          </p>
        )}
      </div>

      {/* Prediction Accuracy */}
      {accuracy && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Prediction Accuracy</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Total Predictions</p>
              <p className="text-lg font-semibold text-gray-900">
                {accuracy.totalPredictions > 0
                  ? accuracy.totalPredictions.toLocaleString()
                  : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Correct</p>
              <p className="text-lg font-semibold text-gray-900">
                {accuracy.correctPredictions > 0
                  ? accuracy.correctPredictions.toLocaleString()
                  : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Accuracy</p>
              <p className="text-lg font-semibold text-gray-900">
                {accuracy.accuracy > 0
                  ? `${(accuracy.accuracy * 100).toFixed(1)}%`
                  : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Last Trained</p>
              <p className="text-sm font-semibold text-gray-900">
                {accuracy.lastTrainedAt
                  ? new Date(accuracy.lastTrainedAt).toLocaleDateString()
                  : "\u2014"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pb-8">
        <Button variant="secondary" onClick={handleReset}>
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} loading={saving}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
