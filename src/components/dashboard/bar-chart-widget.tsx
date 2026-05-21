"use client";

import { BarChartComponent } from "@/components/charts/bar-chart";

interface BarChartWidgetProps {
  data: { name: string; value: number }[] | null;
  loading?: boolean;
}

export function BarChartWidget({ data, loading }: BarChartWidgetProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 250 }}>
        <div className="h-full w-full animate-pulse rounded bg-gray-50" />
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  return <BarChartComponent data={data} height={250} />;
}
