"use client";

import { PieChartComponent } from "@/components/charts/pie-chart";

interface PieChartWidgetProps {
  data: { name: string; value: number }[] | null;
  loading?: boolean;
}

export function PieChartWidget({ data, loading }: PieChartWidgetProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 250 }}>
        <div className="h-32 w-32 animate-pulse rounded-full bg-gray-50" />
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  return <PieChartComponent data={data} height={250} innerRadius={50} outerRadius={90} />;
}
