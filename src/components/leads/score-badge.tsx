"use client";

import { cn } from "@/lib/utils";

export type ScoreTier = "HOT" | "WARM" | "COOL" | "COLD";

const TIER_CONFIG: Record<ScoreTier, { label: string; color: string; bg: string }> = {
  HOT:  { label: "Hot",  color: "#e53935", bg: "rgba(229,57,53,0.12)" },
  WARM: { label: "Warm", color: "#FB8C00", bg: "rgba(251,140,0,0.12)" },
  COOL: { label: "Cool", color: "#7CB342", bg: "rgba(124,179,66,0.12)" },
  COLD: { label: "Cold", color: "#90A4AE", bg: "rgba(144,164,174,0.12)" },
};

export function getScoreTier(score: number): ScoreTier {
  if (score >= 76) return "HOT";
  if (score >= 51) return "WARM";
  if (score >= 26) return "COOL";
  return "COLD";
}

interface ScoreBadgeProps {
  score: number | null | undefined;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function ScoreBadge({ score, size = "sm", showLabel = false, className }: ScoreBadgeProps) {
  if (score == null) {
    return (
      <span className={cn("text-xs text-gray-400", className)} aria-label="No score">
        --
      </span>
    );
  }

  const tier = getScoreTier(score);
  const config = TIER_CONFIG[tier];

  const sizeClasses = {
    sm: "h-6 w-6 text-[10px]",
    md: "h-8 w-8 text-xs",
    lg: "h-10 w-10 text-sm",
  };

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full font-bold",
          sizeClasses[size]
        )}
        style={{ backgroundColor: config.bg, color: config.color, border: `1.5px solid ${config.color}` }}
        title={`Score: ${score} (${config.label})`}
        aria-label={`Lead score ${score}, ${config.label}`}
      >
        {score}
      </span>
      {showLabel && (
        <span className="text-xs font-medium" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </span>
  );
}

/** Tier filter options for dropdowns */
export const SCORE_TIER_OPTIONS = [
  { label: "All Scores", value: "" },
  { label: "Hot (76-100)", value: "HOT" },
  { label: "Warm (51-75)", value: "WARM" },
  { label: "Cool (26-50)", value: "COOL" },
  { label: "Cold (0-25)", value: "COLD" },
];
