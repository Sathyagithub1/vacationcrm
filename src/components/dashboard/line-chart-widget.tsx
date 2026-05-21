"use client";

import { LineChartComponent } from "@/components/charts/line-chart";

interface LineChartWidgetProps {
  data: { name: string; value: number }[] | null;
  loading?: boolean;
}

export function LineChartWidget({ data, loading }: LineChartWidgetProps) {
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

  return <LineChartComponent data={data} height={250} />;
}
