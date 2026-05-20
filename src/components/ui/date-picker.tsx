"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
  error?: string;
}

const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  ({ className, label, value, onChange, min, max, error, id, ...props }, ref) => {
    const inputId = id || React.useId();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            {label}
          </label>
        )}
        <input
          type="date"
          id={inputId}
          ref={ref}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          min={min}
          max={max}
          className={cn(
            "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:cursor-not-allowed disabled:bg-gray-50",
            error && "border-red-500 focus:border-red-500 focus:ring-red-200",
            className
          )}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);
DatePicker.displayName = "DatePicker";

export { DatePicker };
