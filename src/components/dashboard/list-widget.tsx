"use client";

interface ListWidgetProps {
  data: Array<{
    id: string;
    customer?: string;
    stage?: string;
    stageColor?: string;
    department?: string;
    assignee?: string;
    destination?: string | null;
    createdAt?: string;
    [key: string]: unknown;
  }> | null;
  loading?: boolean;
}

export function ListWidget({ data, loading }: ListWidgetProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-gray-50" />
        ))}
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  return (
    <div className="max-h-72 overflow-y-auto">
      <div className="space-y-1.5">
        {data.map((item, index) => (
          <div
            key={item.id || index}
            className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-800 truncate">
                {item.customer || item.id}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {item.destination && <span>{item.destination}</span>}
                {item.department && <span>{item.department}</span>}
                {item.assignee && <span>- {item.assignee}</span>}
              </div>
            </div>
            {item.stage && (
              <span
                className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: item.stageColor || "#6B7280" }}
              >
                {item.stage}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
