"use client";

import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { LeadCard, type LeadCardData } from "./lead-card";

interface PipelineColumnProps {
  stageId: string;
  stageName: string;
  stageColor: string;
  leads: LeadCardData[];
  onLeadClick: (leadId: string) => void;
}

export function PipelineColumn({ stageId, stageName, stageColor, leads, onLeadClick }: PipelineColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stageId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[280px] shrink-0 flex-col rounded-lg border border-gray-200 bg-gray-50 transition-colors",
        isOver && "border-primary-400 bg-primary-50"
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-3">
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: stageColor }}
        />
        <h3 className="text-sm font-semibold text-gray-700 truncate">{stageName}</h3>
        <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {leads.length === 0 ? (
          <p className="py-8 text-center text-xs text-gray-400">No leads</p>
        ) : (
          leads.map((lead) => (
            <DraggableLeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead.id)} />
          ))
        )}
      </div>
    </div>
  );
}

// Separate draggable wrapper using HTML5 drag
import { useDraggable } from "@dnd-kit/core";

function DraggableLeadCard({ lead, onClick }: { lead: LeadCardData; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}>
      <LeadCard lead={lead} onClick={onClick} isDragging={isDragging} />
    </div>
  );
}
