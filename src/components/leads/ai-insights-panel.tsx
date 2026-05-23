"use client";

import * as React from "react";
import { Brain, Clock, User, Send, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreBadge, getScoreTier } from "@/components/leads/score-badge";
import { useToast } from "@/components/ui/toast";

interface ScoreBreakdown {
  total: number;
  engagement: number;
  attributes: number;
  historical: number;
  conversation: number;
  suggestedAction?: string;
  bestFollowUpTime?: string;
  recommendedAgent?: {
    id: string;
    name: string;
    matchScore: number;
  };
}

interface AiInsightsPanelProps {
  leadId: string;
}

function ScoreBar({ label, value, maxValue = 100 }: { label: string; value: number; maxValue?: number }) {
  const pct = Math.min(100, Math.max(0, (value / maxValue) * 100));
  const tier = getScoreTier(value);
  const colorMap = {
    HOT: "#e53935",
    WARM: "#FB8C00",
    COOL: "#7CB342",
    COLD: "#90A4AE",
  };
  const color = colorMap[tier];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="font-semibold" style={{ color }}>{value}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function AiInsightsPanel({ leadId }: AiInsightsPanelProps) {
  const { toast } = useToast();
  const [score, setScore] = React.useState<ScoreBreakdown | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [draftMessage, setDraftMessage] = React.useState<string | null>(null);

  // Fetch score data
  React.useEffect(() => {
    async function fetchScore() {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/${leadId}/score`);
        if (res.ok) {
          const data = await res.json();
          setScore(data.score || null);
        }
      } catch {
        // Score fetch non-critical
      } finally {
        setLoading(false);
      }
    }
    fetchScore();
  }, [leadId]);

  // Draft follow-up message
  async function handleDraftFollowUp() {
    setDraftLoading(true);
    setDraftMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/draft-followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate draft");
      }
      const data = await res.json();
      setDraftMessage(data.message || "");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setDraftLoading(false);
    }
  }

  if (loading) {
    return (
      <Card header={
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900">AI Insights</h3>
        </div>
      }>
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Card>
    );
  }

  if (!score) {
    return (
      <Card header={
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900">AI Insights</h3>
        </div>
      }>
        <p className="text-sm text-gray-500">No scoring data available for this lead yet.</p>
      </Card>
    );
  }

  return (
    <Card header={
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900">AI Insights</h3>
        </div>
        <ScoreBadge score={score.total} size="lg" showLabel />
      </div>
    }>
      <div className="space-y-5">
        {/* Score breakdown bars */}
        <div className="space-y-3">
          <ScoreBar label="Engagement" value={score.engagement} />
          <ScoreBar label="Attributes" value={score.attributes} />
          <ScoreBar label="Historical" value={score.historical} />
          <ScoreBar label="Conversation" value={score.conversation} />
        </div>

        {/* Suggested action */}
        {score.suggestedAction && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-medium text-blue-700">Suggested Action</p>
            <p className="mt-1 text-sm text-blue-900">{score.suggestedAction}</p>
          </div>
        )}

        {/* Best follow-up time */}
        {score.bestFollowUpTime && (
          <div className="flex items-start gap-2.5 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <div>
              <p className="font-medium text-gray-700">Best follow-up time</p>
              <p className="text-gray-500">{score.bestFollowUpTime}</p>
            </div>
          </div>
        )}

        {/* Recommended agent */}
        {score.recommendedAgent && (
          <div className="flex items-start gap-2.5 text-sm">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <div>
              <p className="font-medium text-gray-700">Recommended agent</p>
              <p className="text-gray-500">
                {score.recommendedAgent.name}
                <span className="ml-1.5 text-xs text-gray-400">
                  ({score.recommendedAgent.matchScore}% match)
                </span>
              </p>
            </div>
          </div>
        )}

        {/* Draft follow-up */}
        <div className="border-t border-gray-200 pt-4">
          {draftMessage === null ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDraftFollowUp}
              loading={draftLoading}
              className="w-full"
            >
              <Send className="h-3.5 w-3.5" />
              Draft Follow-up Message
            </Button>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700">
                AI-generated follow-up (editable)
              </label>
              <textarea
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraftMessage(null)}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(draftMessage);
                    toast("success", "Message copied to clipboard");
                  }}
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
