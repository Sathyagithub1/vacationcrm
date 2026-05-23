import type { AITool } from "./tool.interface";
import { createLeadTool } from "./create-lead.tool";
import { checkAvailabilityTool } from "./check-availability.tool";
import { lookupLeadTool } from "./lookup-lead.tool";
import { getPricingTool } from "./get-pricing.tool";
import { scheduleCallbackTool } from "./schedule-callback.tool";
import { handoffTool } from "./handoff.tool";

export type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const allTools: AITool[] = [
  createLeadTool,
  checkAvailabilityTool,
  lookupLeadTool,
  getPricingTool,
  scheduleCallbackTool,
  handoffTool,
];

export function getToolByName(name: string): AITool | undefined {
  return allTools.find((t) => t.definition.name === name);
}

export function getToolDefinitions() {
  return allTools.map((t) => t.definition);
}
