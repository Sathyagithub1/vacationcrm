"use client";

/**
 * AgentMultiSelect
 *
 * Fetches agents from GET /api/users/agents and renders a multi-checkbox list.
 * Supports optional department filtering via a query param.
 *
 * Props:
 *   selected       — array of currently selected agent IDs
 *   onChange       — callback with updated selected ID array
 *   departmentId   — optional: filter agents to this department
 *   label          — optional label above the list
 */

import * as React from "react";
import { Spinner } from "@/components/ui/loading";
import { cn } from "@/lib/utils";

interface Agent {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
}

interface AgentMultiSelectProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  departmentId?: string;
  label?: string;
}

export function AgentMultiSelect({
  selected,
  onChange,
  departmentId,
  label,
}: AgentMultiSelectProps) {
  const [agents,  setAgents]  = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error,   setError]   = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchAgents() {
      setLoading(true);
      setError(null);
      try {
        const url = departmentId
          ? `/api/users/agents?departmentId=${departmentId}`
          : "/api/users/agents";
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load agents");
        const data: { agents: Agent[] } = await res.json();
        setAgents(data.agents);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agents");
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, [departmentId]);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
        <Spinner size="sm" />
        Loading agents…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (agents.length === 0) {
    return <p className="text-sm text-gray-400">No agents found.</p>;
  }

  return (
    <div className="space-y-2">
      {label && (
        <p className="text-sm font-medium text-gray-700">{label}</p>
      )}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
        {agents.map((agent) => {
          const isChecked = selected.includes(agent.id);
          return (
            <label
              key={agent.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors",
                isChecked ? "bg-primary-50" : "hover:bg-gray-50"
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(agent.id)}
                className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-400"
              />
              <div>
                <p className="font-medium text-gray-800">{agent.name}</p>
                <p className="text-xs text-gray-400">{agent.email}</p>
              </div>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-gray-400">
        {selected.length} of {agents.length} selected
      </p>
    </div>
  );
}
