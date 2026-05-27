"use client";

/**
 * SpamRuleForm
 *
 * A wizard-style form for creating a spam rule. Step 1 picks the type;
 * step 2 shows type-specific fields; saving calls POST /api/spam-rules.
 *
 * Types:
 *   BLACKLIST   — identifier (phone/email/handle) required
 *   RATE_LIMIT  — threshold, windowSeconds, blockSeconds
 *   PATTERN     — identifier treated as regex pattern
 *   AI          — aiThreshold (0–1 float)
 *
 * Props:
 *   onCreated — callback fired after successful creation
 *   onCancel  — callback to cancel the wizard
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

type SpamRuleType = "BLACKLIST" | "RATE_LIMIT" | "PATTERN" | "AI";

interface SpamRuleFormProps {
  onCreated: () => void;
  onCancel:  () => void;
}

const RULE_TYPE_OPTIONS = [
  { value: "BLACKLIST",   label: "Blacklist — block specific identifier"   },
  { value: "RATE_LIMIT",  label: "Rate Limit — block high-frequency senders" },
  { value: "PATTERN",     label: "Pattern — regex match on identifier"      },
  { value: "AI",          label: "AI Score — block low-quality AI-scored leads" },
];

export function SpamRuleForm({ onCreated, onCancel }: SpamRuleFormProps) {
  const { toast } = useToast();
  const [step,    setStep]    = React.useState<1 | 2>(1);
  const [type,    setType]    = React.useState<SpamRuleType>("BLACKLIST");
  const [saving,  setSaving]  = React.useState(false);

  // BLACKLIST / PATTERN
  const [identifier, setIdentifier] = React.useState("");

  // RATE_LIMIT
  const [threshold,     setThreshold]     = React.useState(5);
  const [windowSeconds, setWindowSeconds] = React.useState(60);
  const [blockSeconds,  setBlockSeconds]  = React.useState(3600);

  // AI
  const [aiThreshold, setAiThreshold] = React.useState(0.3);

  async function handleSubmit() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { type };

      if (type === "BLACKLIST" || type === "PATTERN") {
        if (!identifier.trim()) {
          toast("error", "Identifier is required");
          setSaving(false);
          return;
        }
        body.identifier = identifier.trim();
      }

      if (type === "RATE_LIMIT") {
        body.threshold     = threshold;
        body.windowSeconds = windowSeconds;
        body.blockSeconds  = blockSeconds;
      }

      if (type === "AI") {
        body.aiThreshold = aiThreshold;
      }

      const res = await fetch("/api/spam-rules", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to create rule");
      }

      toast("success", "Spam rule created");
      onCreated();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Step 1 — pick type */}
      {step === 1 && (
        <>
          <Select
            label="Rule Type"
            options={RULE_TYPE_OPTIONS}
            value={type}
            onChange={(e) => setType(e.target.value as SpamRuleType)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => setStep(2)}>Next →</Button>
          </div>
        </>
      )}

      {/* Step 2 — type-specific fields */}
      {step === 2 && (
        <>
          <p className="text-xs text-gray-500">
            Rule type: <strong>{type}</strong>
            <button
              className="ml-2 text-primary-500 hover:underline"
              onClick={() => setStep(1)}
            >
              Change
            </button>
          </p>

          {(type === "BLACKLIST" || type === "PATTERN") && (
            <Input
              label={type === "PATTERN" ? "Regex Pattern" : "Identifier (phone / email / handle)"}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={type === "PATTERN" ? "e.g. ^\\+91\\d{10}$" : "e.g. +919999999999"}
            />
          )}

          {type === "RATE_LIMIT" && (
            <div className="space-y-3">
              <Input
                label="Message threshold (max messages in window)"
                type="number"
                min={1}
                value={threshold}
                onChange={(e) => setThreshold(Math.max(1, Number(e.target.value)))}
              />
              <Input
                label="Window (seconds)"
                type="number"
                min={1}
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(Math.max(1, Number(e.target.value)))}
              />
              <Input
                label="Block duration (seconds)"
                type="number"
                min={1}
                value={blockSeconds}
                onChange={(e) => setBlockSeconds(Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}

          {type === "AI" && (
            <div className="space-y-2">
              <Input
                label={`AI Spam Threshold (0–1) — currently ${aiThreshold}`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={aiThreshold}
                onChange={(e) =>
                  setAiThreshold(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))
                }
              />
              <p className="text-xs text-gray-500">
                Leads with an AI spam score above this threshold will be blocked.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving}>
              Create Rule
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
