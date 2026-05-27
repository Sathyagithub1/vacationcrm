"use client";

/**
 * /settings/assignment — Assignment strategy configuration page.
 *
 * Presents:
 *  1. Strategy picker (5 radio cards)
 *  2. Per-strategy config panel (only shown for the selected type):
 *     - ROUND_ROBIN / LOAD_BALANCED: no extra config
 *     - SKILL_BASED: skill weight inputs
 *     - AI_TIERED: TierAssignmentGrid
 *     - NAMED_POOLS: PoolManager
 *  3. Save button — PUTs to /api/assignment-strategy
 *
 * Accessible to COMPANY_ADMIN / SUPER_ADMIN only.
 */

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/loading";
import { StrategyPicker, type StrategyType } from "@/components/intake/StrategyPicker";
import { AgentMultiSelect } from "@/components/intake/AgentMultiSelect";
import { PoolManager, type AssignmentPool } from "@/components/intake/PoolManager";
import { TierAssignmentGrid } from "@/components/intake/TierAssignmentGrid";
import { Plus, Trash2 } from "lucide-react";

interface SkillWeight {
  skill: string;
  weight: number;
}

interface StrategyConfig {
  skillWeights?: Record<string, number>;
  lowCutoff?: number;
  highCutoff?: number;
  tiers?: string[][];
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

export default function AssignmentStrategyPage() {
  const { toast } = useToast();

  const [loading,  setLoading]  = React.useState(true);
  const [saving,   setSaving]   = React.useState(false);

  const [strategy, setStrategy] = React.useState<StrategyType | "">("");
  const [config,   setConfig]   = React.useState<StrategyConfig>({});
  const [pools,    setPools]    = React.useState<AssignmentPool[]>([]);
  const [agents,   setAgents]   = React.useState<Agent[]>([]);

  // SKILL_BASED local state
  const [skillWeights, setSkillWeights] = React.useState<SkillWeight[]>([
    { skill: "", weight: 1 },
  ]);

  // AI_TIERED local state
  const [tierCount,    setTierCount]    = React.useState<2 | 3>(2);
  const [lowCutoff,    setLowCutoff]    = React.useState(30);
  const [highCutoff,   setHighCutoff]   = React.useState(70);
  const [agentTiers,   setAgentTiers]   = React.useState<Record<string, number>>({});

  // ROUND_ROBIN / LOAD_BALANCED: selected agent IDs
  const [selectedAgents, setSelectedAgents] = React.useState<string[]>([]);

  async function loadAll() {
    setLoading(true);
    try {
      const [stratRes, poolsRes, agentsRes] = await Promise.all([
        fetch("/api/assignment-strategy"),
        fetch("/api/assignment-pools?limit=100"),
        fetch("/api/users/agents"),
      ]);

      if (stratRes.ok) {
        const data: { strategy: { type: StrategyType; config: StrategyConfig } | null } =
          await stratRes.json();
        if (data.strategy) {
          setStrategy(data.strategy.type);
          setConfig(data.strategy.config ?? {});
          if (data.strategy.config?.skillWeights) {
            const entries = Object.entries(data.strategy.config.skillWeights);
            setSkillWeights(entries.map(([skill, weight]) => ({ skill, weight })));
          }
          if (data.strategy.config?.lowCutoff !== undefined) {
            setLowCutoff(data.strategy.config.lowCutoff);
          }
          if (data.strategy.config?.highCutoff !== undefined) {
            setHighCutoff(data.strategy.config.highCutoff);
          }
          if (data.strategy.config?.tiers) {
            const tierArr = data.strategy.config.tiers;
            setTierCount(tierArr.length >= 3 ? 3 : 2);
            const newTiers: Record<string, number> = {};
            tierArr.forEach((group, idx) => {
              group.forEach((agentId) => { newTiers[agentId] = idx; });
            });
            setAgentTiers(newTiers);
          }
        }
      }

      if (poolsRes.ok) {
        const data: { pools: AssignmentPool[] } = await poolsRes.json();
        setPools(data.pools ?? []);
      }

      if (agentsRes.ok) {
        const data: { agents: Agent[] } = await agentsRes.json();
        setAgents(data.agents ?? []);
      }
    } catch {
      toast("error", "Failed to load assignment settings");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadPools() {
    try {
      const res = await fetch("/api/assignment-pools?limit=100");
      if (res.ok) {
        const data: { pools: AssignmentPool[] } = await res.json();
        setPools(data.pools ?? []);
      }
    } catch {
      // silent
    }
  }

  function buildConfig(): StrategyConfig {
    switch (strategy) {
      case "SKILL_BASED": {
        const skillWeightsObj: Record<string, number> = {};
        skillWeights.forEach(({ skill, weight }) => {
          if (skill.trim()) skillWeightsObj[skill.trim()] = weight;
        });
        return { skillWeights: skillWeightsObj };
      }
      case "AI_TIERED": {
        // Build tiers array from agentTiers map
        const numTiers = tierCount;
        const tiersArr: string[][] = Array.from({ length: numTiers }, () => []);
        agents.forEach((agent) => {
          const tier = agentTiers[agent.id] ?? 0;
          const idx  = Math.min(tier, numTiers - 1);
          tiersArr[idx].push(agent.id);
        });
        return { lowCutoff, highCutoff, tiers: tiersArr };
      }
      default:
        return {};
    }
  }

  async function handleSave() {
    if (!strategy) {
      toast("error", "Please select a strategy");
      return;
    }
    setSaving(true);
    try {
      const builtConfig = buildConfig();
      const res = await fetch("/api/assignment-strategy", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: strategy, config: builtConfig }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save strategy");
      }
      toast("success", "Assignment strategy saved");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to save strategy");
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

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Assignment Strategy</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Choose how incoming leads are distributed to agents.
        </p>
      </div>

      {/* Strategy picker */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Strategy Type</h3>
        <StrategyPicker
          value={strategy}
          onChange={(v) => setStrategy(v)}
        />
      </div>

      {/* Per-strategy config */}
      {strategy === "ROUND_ROBIN" || strategy === "LOAD_BALANCED" ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Agent Pool</h3>
          <p className="text-xs text-gray-500">
            Optionally restrict distribution to a subset of agents. Leave empty to include all.
          </p>
          <AgentMultiSelect
            selected={selectedAgents}
            onChange={setSelectedAgents}
            label="Eligible agents (leave blank for all)"
          />
        </div>
      ) : null}

      {strategy === "SKILL_BASED" && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Skill Weights</h3>
          <p className="text-xs text-gray-500">
            Define skills and their relative importance. Agents with higher scores on
            heavily-weighted skills will be prioritised.
          </p>
          <div className="space-y-2">
            {skillWeights.map((sw, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <Input
                  label={idx === 0 ? "Skill name" : undefined}
                  value={sw.skill}
                  onChange={(e) => {
                    const updated = [...skillWeights];
                    updated[idx] = { ...sw, skill: e.target.value };
                    setSkillWeights(updated);
                  }}
                  placeholder="e.g. maldives, arabic, luxury"
                  className="flex-1"
                />
                <Input
                  label={idx === 0 ? "Weight" : undefined}
                  type="number"
                  min={0}
                  value={sw.weight}
                  onChange={(e) => {
                    const updated = [...skillWeights];
                    updated[idx] = { ...sw, weight: Math.max(0, Number(e.target.value)) };
                    setSkillWeights(updated);
                  }}
                  className="w-24"
                />
                <button
                  onClick={() => setSkillWeights(skillWeights.filter((_, i) => i !== idx))}
                  className="mb-1 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove skill"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSkillWeights([...skillWeights, { skill: "", weight: 1 }])}
          >
            <Plus className="h-4 w-4" />
            Add skill
          </Button>
        </div>
      )}

      {strategy === "AI_TIERED" && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">AI Tiered Configuration</h3>
          <TierAssignmentGrid
            tierCount={tierCount}
            onTierCountChange={setTierCount}
            lowCutoff={lowCutoff}
            highCutoff={highCutoff}
            onLowCutoffChange={setLowCutoff}
            onHighCutoffChange={setHighCutoff}
            agentTiers={agentTiers}
            agents={agents}
            onAgentTierChange={(agentId, tier) =>
              setAgentTiers((prev) => ({ ...prev, [agentId]: tier }))
            }
          />
        </div>
      )}

      {strategy === "NAMED_POOLS" && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Named Pools</h3>
          <p className="text-xs text-gray-500">
            Leads are matched to a pool by tag or source, then round-robined within that pool.
          </p>
          <PoolManager pools={pools} onReload={reloadPools} />
        </div>
      )}

      {/* Save */}
      {strategy && (
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={saving}>
            Save Strategy
          </Button>
        </div>
      )}
    </div>
  );
}
