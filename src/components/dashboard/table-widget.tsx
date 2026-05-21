"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

interface TableWidgetProps {
  data: Array<Record<string, unknown>> | null;
  loading?: boolean;
}

export function TableWidget({ data, loading }: TableWidgetProps) {
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-full animate-pulse rounded bg-gray-50" />
        ))}
      </div>
    );
  }

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-gray-400">No data</div>;
  }

  // Derive columns from first row, exclude internal fields
  const columns = Object.keys(data[0]).filter(
    (k) => !["id", "stageColor"].includes(k) && typeof data[0][k] !== "object"
  );

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortField) return 0;
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal || "");
    const bStr = String(bVal || "");
    return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="cursor-pointer whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 hover:text-gray-900"
              >
                <span className="flex items-center gap-1">
                  {col.charAt(0).toUpperCase() + col.slice(1).replace(/([A-Z])/g, " $1")}
                  {sortField === col && (
                    sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              {columns.map((col) => (
                <td key={col} className="whitespace-nowrap px-3 py-2 text-gray-700">
                  {row[col] !== null && row[col] !== undefined ? String(row[col]) : "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
