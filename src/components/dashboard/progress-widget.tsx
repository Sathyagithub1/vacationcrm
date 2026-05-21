"use client";

interface ProgressWidgetProps {
  data: { name: string; value: number; color?: string }[] | null;
  loading?: boolean;
}

const COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#f43f5e", "#f97316", "#22c55e", "#06b6d4"];

export function ProgressWidget({ data, loading }: ProgressWidgetProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-6 w-full animate-pulse rounded bg-gray-50" />
        ))}
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3">
      {data.map((item, index) => {
        const percent = Math.round((item.value / maxValue) * 100);
        const color = item.color || COLORS[index % COLORS.length];

        return (
          <div key={item.name}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700 truncate">{item.name}</span>
              <span className="text-gray-500">{item.value.toLocaleString()}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-gray-100">
              <div
                className="h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${percent}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
