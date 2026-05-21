"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface BarChartData {
  name: string;
  value: number;
  [key: string]: string | number;
}

interface BarChartProps {
  data: BarChartData[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  colors?: string[];
  bars?: { dataKey: string; color: string; name?: string }[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
}

const DEFAULT_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4",
];

export function BarChartComponent({
  data,
  dataKey = "value",
  xKey = "name",
  color = "#6366f1",
  bars,
  height = 300,
  showGrid = true,
  showLegend = false,
}: BarChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
          }}
        />
        {showLegend && <Legend />}
        {bars ? (
          bars.map((b) => (
            <Bar key={b.dataKey} dataKey={b.dataKey} fill={b.color} name={b.name || b.dataKey} radius={[4, 4, 0, 0]} />
          ))
        ) : (
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        )}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
