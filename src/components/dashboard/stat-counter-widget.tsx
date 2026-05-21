"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCounterWidgetProps {
  data: { value: number; label: string; converted?: number; total?: number } | null;
  loading?: boolean;
}

export function StatCounterWidget({ data, loading }: StatCounterWidgetProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <div className="h-8 w-20 animate-pulse rounded bg-gray-100" />
        <div className="mt-2 h-4 w-32 animate-pulse rounded bg-gray-50" />
      </div>
    );
  }

  if (!data) {
    return <div className="py-6 text-center text-sm text-gray-400">No data</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <span className="text-3xl font-bold text-gray-900">
        {typeof data.value === "number" ? data.value.toLocaleString() : data.value}
        {data.label?.includes("%") ? "%" : ""}
      </span>
      <span className="mt-1 text-xs text-gray-500">{data.label}</span>
      {data.converted !== undefined && data.total !== undefined && (
        <span className="mt-1 text-xs text-gray-400">
          {data.converted} of {data.total}
        </span>
      )}
    </div>
  );
}
