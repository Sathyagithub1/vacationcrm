"use client";

import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { PipelineColumn } from "./pipeline-column";
import type { LeadCardData } from "./lead-card";

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface PipelineBoardProps {
  stages: Stage[];
  leads: LeadCardData[];
  onStageChange: (leadId: string, newStageId: string) => void;
  onLeadClick: (leadId: string) => void;
}

export function PipelineBoard({ stages, leads, onStageChange, onLeadClick }: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;
    const newStageId = over.id as string;

    // Find the lead's current stage
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    // Get the lead's current stageId
    const currentStageId = (lead as unknown as { stageId?: string }).stageId;

    // Skip API call if dropped on the same stage
    if (currentStageId === newStageId) return;

    onStageChange(leadId, newStageId);
  }

  // Sort stages by position
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  // Group leads by stageId
  const leadsByStage: Record<string, LeadCardData[]> = {};
  for (const stage of sortedStages) {
    leadsByStage[stage.id] = [];
  }
  for (const lead of leads) {
    // We need to find which stage this lead belongs to
    // The lead data from the API includes stage info through the parent
    // We match by checking if the lead has a stageId-like field
    // Since lead cards come from the list API, we need to match by stage
    const stageId = (lead as unknown as { stageId?: string }).stageId;
    if (stageId && leadsByStage[stageId]) {
      leadsByStage[stageId].push(lead);
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 260px)" }}>
        {sortedStages.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stageId={stage.id}
            stageName={stage.name}
            stageColor={stage.color}
            leads={leadsByStage[stage.id] || []}
            onLeadClick={onLeadClick}
          />
        ))}
      </div>
    </DndContext>
  );
}
