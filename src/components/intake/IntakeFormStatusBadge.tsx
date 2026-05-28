/**
 * IntakeFormStatusBadge
 *
 * Renders a colour-coded badge for IntakeForm.status values:
 *   ACTIVE    → green
 *   PAUSED    → yellow
 *   PENDING   → blue (waiting for first payload / field-map confirmation)
 *   ERROR     → red
 *
 * Props:
 *   status — the raw status string from the API
 */

import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

type IntakeFormStatus = "ACTIVE" | "PAUSED" | "PENDING" | "ERROR";

const statusConfig: Record<
  IntakeFormStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  ACTIVE:  { label: "Active",  variant: "success"  },
  PAUSED:  { label: "Paused",  variant: "warning"  },
  PENDING: { label: "Pending", variant: "info"     },
  ERROR:   { label: "Error",   variant: "danger"   },
};

interface IntakeFormStatusBadgeProps {
  status: string;
}

export function IntakeFormStatusBadge({ status }: IntakeFormStatusBadgeProps) {
  const cfg = statusConfig[status as IntakeFormStatus] ?? {
    label: status,
    variant: "default" as const,
  };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
