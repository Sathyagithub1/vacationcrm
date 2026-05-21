"use client";

import { GripVertical, X, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface WidgetCardProps {
  title: string;
  size: "SMALL" | "MEDIUM" | "LARGE";
  editing?: boolean;
  onRemove?: () => void;
  onEdit?: () => void;
  dragHandleProps?: Record<string, unknown>;
  children: React.ReactNode;
}

const sizeClasses = {
  SMALL: "col-span-1",
  MEDIUM: "col-span-1 md:col-span-2",
  LARGE: "col-span-1 md:col-span-2 lg:col-span-3",
};

export function WidgetCard({
  title,
  size,
  editing,
  onRemove,
  onEdit,
  dragHandleProps,
  children,
}: WidgetCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md",
        sizeClasses[size],
        editing && "ring-2 ring-primary-200"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          {editing && (
            <button {...(dragHandleProps || {})} className="cursor-grab text-gray-400 hover:text-gray-600">
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <h3 className="text-sm font-semibold text-gray-800 truncate">{title}</h3>
        </div>
        {editing && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={onEdit}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {/* Body */}
      <div className="p-4">{children}</div>
    </div>
  );
}
