"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  presets?: string[];
  label?: string;
  className?: string;
}

const defaultPresets = [
  "#FF6B35",
  "#E55A2B",
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#EC4899",
];

function ColorPicker({
  value,
  onChange,
  presets = defaultPresets,
  label,
  className,
}: ColorPickerProps) {
  const [customHex, setCustomHex] = React.useState(value || "");

  const handleCustomChange = (hex: string) => {
    setCustomHex(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => {
              onChange(color);
              setCustomHex(color);
            }}
            className={cn(
              "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
              value === color ? "border-gray-900 ring-2 ring-primary-300" : "border-gray-200"
            )}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div
          className="h-8 w-8 rounded-md border border-gray-300"
          style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(customHex) ? customHex : "#FFFFFF" }}
        />
        <input
          type="text"
          value={customHex}
          onChange={(e) => handleCustomChange(e.target.value)}
          placeholder="#FF6B35"
          maxLength={7}
          className="flex h-8 w-28 rounded-md border border-gray-300 bg-white px-2 text-sm font-mono focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      </div>
    </div>
  );
}

export { ColorPicker };
