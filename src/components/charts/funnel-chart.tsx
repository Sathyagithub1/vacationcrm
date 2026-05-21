"use client";

export interface FunnelChartData {
  name: string;
  value: number;
  color?: string;
}

interface FunnelChartProps {
  data: FunnelChartData[];
  height?: number;
}

const DEFAULT_COLORS = [
  "#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe",
  "#ddd6fe", "#e9d5ff", "#f3e8ff",
];

export function FunnelChartComponent({ data, height = 300 }: FunnelChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: height }}>
      {data.map((item, index) => {
        const widthPercent = Math.max((item.value / maxValue) * 100, 15);
        const color = item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

        return (
          <div key={item.name} className="flex items-center gap-3">
            <div className="w-28 text-right text-xs font-medium text-gray-600 truncate">
              {item.name}
            </div>
            <div className="flex-1 relative">
              <div
                className="h-9 rounded-md flex items-center px-3 transition-all duration-300"
                style={{ width: `${widthPercent}%`, backgroundColor: color }}
              >
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  {item.value.toLocaleString()}
                </span>
              </div>
            </div>
            {index > 0 && (
              <div className="w-14 text-right text-xs text-gray-400">
                {((item.value / data[0].value) * 100).toFixed(0)}%
              </div>
            )}
            {index === 0 && <div className="w-14 text-right text-xs text-gray-400">100%</div>}
          </div>
        );
      })}
    </div>
  );
}
