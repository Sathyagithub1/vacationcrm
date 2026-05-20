"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface Tab {
  label: string;
  value: string;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (value: string) => void;
  className?: string;
}

function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("border-b border-gray-200", className)}>
      <nav className="-mb-px flex gap-6" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => onChange(tab.value)}
            className={cn(
              "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors",
              activeTab === tab.value
                ? "border-primary-500 text-primary-600"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export { Tabs };
