"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WidgetCard } from "./widget-card";
import { StatCounterWidget } from "./stat-counter-widget";
import { BarChartWidget } from "./bar-chart-widget";
import { PieChartWidget } from "./pie-chart-widget";
import { ProgressWidget } from "./progress-widget";
import { ListWidget } from "./list-widget";
import { LineChartWidget } from "./line-chart-widget";
import { TableWidget } from "./table-widget";
import { FunnelWidget } from "./funnel-widget";
import { ActivityFeedWidget } from "./activity-feed-widget";

export interface WidgetData {
  id: string;
  widgetType: string;
  title: string;
  dataSource: string;
  filters: Record<string, string> | null;
  size: "SMALL" | "MEDIUM" | "LARGE";
  position: unknown;
  refreshInterval: number;
}

interface WidgetGridProps {
  widgets: WidgetData[];
  editing: boolean;
  onRemove: (id: string) => void;
  onReorder: (widgets: WidgetData[]) => void;
}

function SortableWidget({
  widget,
  editing,
  onRemove,
}: {
  widget: WidgetData;
  editing: boolean;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: widget.id });
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ dataSource: widget.dataSource });
      const filters = widget.filters;
      if (filters?.departmentId) params.set("departmentId", filters.departmentId);
      if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters?.dateTo) params.set("dateTo", filters.dateTo);

      const res = await fetch(`/api/widgets/data?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch {
      // Keep previous data on error
    } finally {
      setLoading(false);
    }
  }, [widget.dataSource, widget.filters]);

  useEffect(() => {
    fetchData();

    // Auto-refresh
    const interval = setInterval(fetchData, (widget.refreshInterval || 300) * 1000);
    return () => clearInterval(interval);
  }, [fetchData, widget.refreshInterval]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const renderWidget = () => {
    switch (widget.widgetType) {
      case "STAT_COUNTER":
        return <StatCounterWidget data={data as any} loading={loading} />;
      case "BAR_CHART":
        return <BarChartWidget data={data as any} loading={loading} />;
      case "PIE":
        return <PieChartWidget data={data as any} loading={loading} />;
      case "PROGRESS":
        return <ProgressWidget data={data as any} loading={loading} />;
      case "LIST":
        return <ListWidget data={data as any} loading={loading} />;
      case "LINE":
        return <LineChartWidget data={data as any} loading={loading} />;
      case "TABLE":
        return <TableWidget data={data as any} loading={loading} />;
      case "FUNNEL":
        return <FunnelWidget data={data as any} loading={loading} />;
      case "ACTIVITY":
        return <ActivityFeedWidget data={data as any} loading={loading} />;
      default:
        return <div className="text-sm text-gray-400">Unknown widget type</div>;
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <WidgetCard
        title={widget.title}
        size={widget.size}
        editing={editing}
        onRemove={() => onRemove(widget.id)}
        dragHandleProps={{ ...attributes, ...listeners }}
      >
        {renderWidget()}
      </WidgetCard>
    </div>
  );
}

export function WidgetGrid({ widgets, editing, onRemove, onReorder }: WidgetGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = widgets.findIndex((w) => w.id === active.id);
    const newIndex = widgets.findIndex((w) => w.id === over.id);
    const reordered = arrayMove(widgets, oldIndex, newIndex);
    onReorder(reordered);
  };

  if (widgets.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center">
        <p className="text-sm text-gray-500">
          No widgets yet. Click &quot;+ Add Widget&quot; to get started.
        </p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {widgets.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              editing={editing}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
