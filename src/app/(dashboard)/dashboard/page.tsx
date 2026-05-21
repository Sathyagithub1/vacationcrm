"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Check } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { WidgetGrid, type WidgetData } from "@/components/dashboard/widget-grid";
import { WidgetBuilder, type WidgetConfig } from "@/components/dashboard/widget-builder";

export default function DashboardPage() {
  const { toast } = useToast();
  const [widgets, setWidgets] = useState<WidgetData[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchWidgets = useCallback(async () => {
    try {
      const res = await fetch("/api/widgets");
      if (res.ok) {
        const json = await res.json();
        setWidgets(json.widgets || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      if (res.ok) {
        const json = await res.json();
        setDepartments(json.departments || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchWidgets();
    fetchDepartments();
  }, [fetchWidgets, fetchDepartments]);

  const handleAddWidget = async (config: WidgetConfig) => {
    try {
      const res = await fetch("/api/widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widgetType: config.widgetType,
          title: config.title,
          dataSource: config.dataSource,
          size: config.size,
          filters: {
            ...(config.departmentId && { departmentId: config.departmentId }),
            ...(config.dateFrom && { dateFrom: config.dateFrom }),
            ...(config.dateTo && { dateTo: config.dateTo }),
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setWidgets((prev) => [...prev, json.widget]);
      } else {
        toast("error", "Failed to add widget");
      }
    } catch {
      toast("error", "Failed to add widget");
    }
  };

  const handleRemoveWidget = async (id: string) => {
    try {
      const res = await fetch(`/api/widgets/${id}`, { method: "DELETE" });
      if (res.ok) {
        setWidgets((prev) => prev.filter((w) => w.id !== id));
      } else {
        toast("error", "Failed to remove widget");
      }
    } catch {
      toast("error", "Failed to remove widget");
    }
  };

  const handleReorder = async (reordered: WidgetData[]) => {
    setWidgets(reordered);

    // Save positions
    for (let i = 0; i < reordered.length; i++) {
      try {
        await fetch(`/api/widgets/${reordered[i].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: { order: i } }),
        });
      } catch {
        toast("error", "Failed to save widget order");
      }
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Overview of your CRM activity" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of your CRM activity">
        <Button
          variant={editing ? "primary" : "ghost"}
          size="sm"
          onClick={() => setEditing(!editing)}
        >
          {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          {editing ? "Done" : "Edit Layout"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setBuilderOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Add Widget
        </Button>
      </PageHeader>

      <div className="mt-6">
        <WidgetGrid
          widgets={widgets}
          editing={editing}
          onRemove={handleRemoveWidget}
          onReorder={handleReorder}
        />
      </div>

      <WidgetBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onSave={handleAddWidget}
        departments={departments}
      />
    </div>
  );
}
