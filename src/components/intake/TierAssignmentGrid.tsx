"use client";

/**
 * TierAssignmentGrid
 *
 * Used for AI_TIERED strategy configuration.
 * Renders a tier count toggle (2 or 3 tiers) and a grid of agents with a
 * per-agent tier dropdown plus score cutoff inputs.
 *
 * Props:
 *   tierCount       — 2 or 3
 *   onTierCountChange — callback when user changes tier count
 *   lowCutoff       — score threshold below which a lead is "low" (0–100)
 *   highCutoff      — score threshold above which a lead is "high" (0–100)
 *   onLowCutoffChange  — callback
 *   onHighCutoffChange — callback
 *   agentTiers      — map of agentId → tier index (0=low, 1=mid, 2=high)
 *   agents          — list of agents (id + name)
 *   onAgentTierChange — callback when a single agent tier changes
 */

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type TierCount = 2 | 3;

interface Agent {
  id: string;
  name: string;
  email: string;
}

interface TierAssignmentGridProps {
  tierCount: TierCount;
  onTierCountChange: (count: TierCount) => void;
  lowCutoff: number;
  highCutoff: number;
  onLowCutoffChange: (v: number) => void;
  onHighCutoffChange: (v: number) => void;
  agentTiers: Record<string, number>;
  agents: Agent[];
  onAgentTierChange: (agentId: string, tier: number) => void;
}

const TIER_2_OPTIONS = [
  { value: "0", label: "Tier 1 — Low score"  },
  { value: "1", label: "Tier 2 — High score" },
];

const TIER_3_OPTIONS = [
  { value: "0", label: "Tier 1 — Low score"  },
  { value: "1", label: "Tier 2 — Mid score"  },
  { value: "2", label: "Tier 3 — High score" },
];

export function TierAssignmentGrid({
  tierCount,
  onTierCountChange,
  lowCutoff,
  highCutoff,
  onLowCutoffChange,
  onHighCutoffChange,
  agentTiers,
  agents,
  onAgentTierChange,
}: TierAssignmentGridProps) {
  const tierOptions = tierCount === 2 ? TIER_2_OPTIONS : TIER_3_OPTIONS;

  return (
    <div className="space-y-4">
      {/* Tier count toggle */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700">Number of tiers:</span>
        <div className="flex gap-2">
          {([2, 3] as TierCount[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onTierCountChange(n)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tierCount === n
                  ? "bg-primary-500 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {n} Tiers
            </button>
          ))}
        </div>
      </div>

      {/* Score cutoffs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Low score cutoff (0–100)"
          type="number"
          min={0}
          max={100}
          value={lowCutoff}
          onChange={(e) => onLowCutoffChange(Math.min(100, Math.max(0, Number(e.target.value))))}
        />
        <Input
          label="High score cutoff (0–100)"
          type="number"
          min={0}
          max={100}
          value={highCutoff}
          onChange={(e) => onHighCutoffChange(Math.min(100, Math.max(0, Number(e.target.value))))}
        />
      </div>

      <p className="text-xs text-gray-500">
        Score &lt; {lowCutoff} → Tier 1 (low)
        {tierCount === 3 && ` · ${lowCutoff}–${highCutoff} → Tier 2 (mid)`}
        {` · Score ≥ ${highCutoff} → Tier ${tierCount} (high)`}
      </p>

      {/* Per-agent tier assignments */}
      {agents.length === 0 ? (
        <p className="text-sm text-gray-400">No agents — save strategy first then add agents.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Agent
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Assigned Tier
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agents.map((agent) => (
                <tr key={agent.id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-800">{agent.name}</p>
                    <p className="text-xs text-gray-400">{agent.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      options={tierOptions}
                      value={String(agentTiers[agent.id] ?? 0)}
                      onChange={(e) => onAgentTierChange(agent.id, Number(e.target.value))}
                      className="h-8 text-xs w-44"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
