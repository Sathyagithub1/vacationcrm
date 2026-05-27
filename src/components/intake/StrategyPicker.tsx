"use client";

/**
 * StrategyPicker
 *
 * Five radio cards for selecting an assignment strategy type.
 * Each card shows the strategy name + short description.
 *
 * Props:
 *   value    — currently selected strategy type (string)
 *   onChange — callback with new strategy type
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type StrategyType =
  | "ROUND_ROBIN"
  | "LOAD_BALANCED"
  | "SKILL_BASED"
  | "AI_TIERED"
  | "NAMED_POOLS";

interface StrategyOption {
  value: StrategyType;
  label: string;
  description: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  {
    value: "ROUND_ROBIN",
    label: "Round Robin",
    description:
      "Distribute leads evenly in turn across all available agents. Simple and fair.",
  },
  {
    value: "LOAD_BALANCED",
    label: "Load Balanced",
    description:
      "Always assign the next lead to the agent with the fewest open conversations.",
  },
  {
    value: "SKILL_BASED",
    label: "Skill-Based",
    description:
      "Match leads to agents by skill weights (language, destination expertise, etc.).",
  },
  {
    value: "AI_TIERED",
    label: "AI Tiered",
    description:
      "AI scores each lead; route hot leads to senior agents, cool leads to juniors.",
  },
  {
    value: "NAMED_POOLS",
    label: "Named Pools",
    description:
      "Organise agents into named pools; leads are round-robined within the matching pool.",
  },
];

interface StrategyPickerProps {
  value: StrategyType | "";
  onChange: (value: StrategyType) => void;
}

export function StrategyPicker({ value, onChange }: StrategyPickerProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {STRATEGY_OPTIONS.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
              isSelected
                ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500"
                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
            )}
          >
            <div className="flex items-start gap-3">
              {/* Radio dot */}
              <div
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                  isSelected
                    ? "border-primary-500 bg-primary-500"
                    : "border-gray-300 bg-white"
                )}
              >
                {isSelected && (
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{opt.description}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
