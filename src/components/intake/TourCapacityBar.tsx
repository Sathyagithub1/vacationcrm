/**
 * TourCapacityBar
 *
 * Visual capacity bar for a tour.
 *
 * Colour coding:
 *   0–69%  → green
 *   70–89% → amber
 *   90%+   → red (near sold-out)
 *   100%   → red + "Sold out" label
 *
 * Props:
 *   booked   — number of booked seats
 *   capacity — total seat capacity
 *   showText — whether to show "X / Y seats" text (default true)
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface TourCapacityBarProps {
  booked: number;
  capacity: number;
  showText?: boolean;
  className?: string;
}

export function TourCapacityBar({
  booked,
  capacity,
  showText = true,
  className,
}: TourCapacityBarProps) {
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;

  const barColor =
    pct >= 100
      ? "bg-red-500"
      : pct >= 90
      ? "bg-red-400"
      : pct >= 70
      ? "bg-amber-400"
      : "bg-green-500";

  return (
    <div className={cn("space-y-1", className)}>
      {showText && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {booked} / {capacity} seats
          </span>
          {pct >= 100 ? (
            <span className="font-medium text-red-600">Sold out</span>
          ) : (
            <span>{pct}%</span>
          )}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
