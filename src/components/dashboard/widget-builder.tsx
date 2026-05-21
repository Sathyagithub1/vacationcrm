"use client";

import { useState } from "react";
import { X, BarChart3, PieChart, TrendingUp, Hash, List, Table, Activity, ArrowDownRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WidgetConfig {
  widgetType: string;
  title: string;
  dataSource: string;
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  size: "SMALL" | "MEDIUM" | "LARGE";
}

interface WidgetBuilderProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: WidgetConfig) => void;
  departments: { id: string; name: string }[];
}

const WIDGET_TYPES = [
  { type: "STAT_COUNTER", label: "Stat Counter", icon: Hash, description: "Single metric with label" },
  { type: "BAR_CHART", label: "Bar Chart", icon: BarChart3, description: "Grouped bar comparison" },
  { type: "PIE", label: "Pie / Donut", icon: PieChart, description: "Category breakdown" },
  { type: "PROGRESS", label: "Progress Bars", icon: Layers, description: "Category comparison bars" },
  { type: "LIST", label: "List", icon: List, description: "Scrollable item list" },
  { type: "LINE", label: "Line Chart", icon: TrendingUp, description: "Trend over time" },
  { type: "TABLE", label: "Data Table", icon: Table, description: "Sortable data table" },
  { type: "FUNNEL", label: "Funnel", icon: ArrowDownRight, description: "Pipeline funnel" },
  { type: "ACTIVITY", label: "Activity Feed", icon: Activity, description: "Live event stream" },
];

const DATA_SOURCES = [
  { value: "leads_total", label: "Total Leads", types: ["STAT_COUNTER"] },
  { value: "leads_by_stage", label: "Leads by Stage", types: ["BAR_CHART", "PIE", "PROGRESS", "FUNNEL", "TABLE"] },
  { value: "leads_by_department", label: "Leads by Department", types: ["BAR_CHART", "PIE", "PROGRESS", "TABLE"] },
  { value: "leads_by_source", label: "Leads by Source", types: ["BAR_CHART", "PIE", "PROGRESS", "TABLE"] },
  { value: "leads_by_date", label: "Leads by Date", types: ["LINE", "BAR_CHART", "TABLE"] },
  { value: "conversion_rate", label: "Conversion Rate", types: ["STAT_COUNTER"] },
  { value: "follow_ups_due", label: "Follow-ups Due", types: ["STAT_COUNTER"] },
  { value: "follow_ups_by_type", label: "Follow-ups by Type", types: ["BAR_CHART", "PIE", "PROGRESS", "TABLE"] },
  { value: "callbacks_scheduled", label: "Scheduled Callbacks", types: ["STAT_COUNTER"] },
  { value: "agent_performance", label: "Agent Performance", types: ["BAR_CHART", "TABLE", "PROGRESS"] },
  { value: "department_performance", label: "Department Performance", types: ["BAR_CHART", "TABLE", "PROGRESS"] },
  { value: "recent_leads", label: "Recent Leads", types: ["LIST", "TABLE"] },
  { value: "recent_activities", label: "Recent Activities", types: ["ACTIVITY", "TABLE"] },
  { value: "response_time_avg", label: "Avg Response Time", types: ["STAT_COUNTER"] },
];

export function WidgetBuilder({ open, onClose, onSave, departments }: WidgetBuilderProps) {
  const [step, setStep] = useState<"type" | "configure">("type");
  const [selectedType, setSelectedType] = useState<string>("");
  const [title, setTitle] = useState("");
  const [dataSource, setDataSource] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [size, setSize] = useState<"SMALL" | "MEDIUM" | "LARGE">("SMALL");

  const reset = () => {
    setStep("type");
    setSelectedType("");
    setTitle("");
    setDataSource("");
    setDepartmentId("");
    setDateFrom("");
    setDateTo("");
    setSize("SMALL");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSelectType = (type: string) => {
    setSelectedType(type);
    setStep("configure");

    // Auto-select first compatible data source
    const compatible = DATA_SOURCES.filter((ds) => ds.types.includes(type));
    if (compatible.length > 0) {
      setDataSource(compatible[0].value);
      setTitle(compatible[0].label);
    }
  };

  const handleSave = () => {
    if (!selectedType || !title || !dataSource) return;

    onSave({
      widgetType: selectedType,
      title,
      dataSource,
      departmentId: departmentId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      size,
    });

    handleClose();
  };

  const compatibleSources = DATA_SOURCES.filter((ds) => ds.types.includes(selectedType));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/30" onClick={handleClose} />
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === "type" ? "Add Widget" : "Configure Widget"}
          </h2>
          <button onClick={handleClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === "type" ? (
            <div className="grid grid-cols-2 gap-3">
              {WIDGET_TYPES.map((wt) => {
                const Icon = wt.icon;
                return (
                  <button
                    key={wt.type}
                    onClick={() => handleSelectType(wt.type)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 text-center hover:border-primary-300 hover:bg-primary-50 transition-colors"
                  >
                    <Icon className="h-6 w-6 text-primary-500" />
                    <span className="text-sm font-medium text-gray-800">{wt.label}</span>
                    <span className="text-[10px] text-gray-400">{wt.description}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="Widget title"
                />
              </div>

              {/* Data Source */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Data Source</label>
                <select
                  value={dataSource}
                  onChange={(e) => {
                    setDataSource(e.target.value);
                    const found = DATA_SOURCES.find((ds) => ds.value === e.target.value);
                    if (found && !title) setTitle(found.label);
                  }}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  {compatibleSources.map((ds) => (
                    <option key={ds.value} value={ds.value}>
                      {ds.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Department Filter */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Department (optional)</label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>

              {/* Size */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Size</label>
                <div className="flex gap-2">
                  {(["SMALL", "MEDIUM", "LARGE"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSize(s)}
                      className={cn(
                        "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        size === s
                          ? "border-primary-400 bg-primary-50 text-primary-700"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "configure" && (
          <div className="border-t border-gray-200 px-5 py-4 flex items-center gap-3">
            <Button variant="ghost" onClick={() => setStep("type")} className="flex-1">
              Back
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!title || !dataSource}
              className="flex-1"
            >
              Add Widget
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
