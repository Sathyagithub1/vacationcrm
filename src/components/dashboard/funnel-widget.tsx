"use client";

import { FunnelChartComponent } from "@/components/charts/funnel-chart";

interface FunnelWidgetProps {
  data: { name: string; value: number; color?: string }[] | null;
  loading?: boolean;
}

export function FunnelWidget({ data, loading }: FunnelWidgetProps) {
  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="mx-auto h-8 animate-pulse rounded bg-gray-50" style={{ width: `${100 - i * 15}%` }} />
        ))}
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  return <FunnelChartComponent data={data} height={250} />;
}
