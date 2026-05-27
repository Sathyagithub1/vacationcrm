// src/modules/intake/types.ts
import type { LeadSource } from '@prisma/client';

export interface IntakePayload {
  tenantId: string;
  source: LeadSource;
  rawPayload: Record<string, unknown>;
  sender: { phone?: string; email?: string; channelHandle?: string };
  intakeFormId?: string;
  canonicalFields?: {
    name?: string; phone?: string; email?: string;
    language?: string; tourCode?: string; notes?: string;
    tags?: string[];
    [k: string]: unknown;
  };
  departmentId?: string;
  tourMatch?: { tourId: string; confidence: number; soldOut: boolean };
  dedupResult?: { existingLeadId?: string; existingCustomerId?: string };
  spamCheck?: { passed: boolean; matchedRuleId?: string };
  webhookLogId: string;
  leadId?: string;
  /** Elevated routing priority; set to HIGH when a sold-out tour is matched. */
  priority?: "LOW" | "NORMAL" | "HIGH";
  /**
   * Outbound message staged by the tour orchestrator when a sold-out tour is
   * matched. Written to Conversation/Message by the dispatch stage (T31) after
   * the Lead is created — NOT written here because leadId doesn't exist yet.
   */
  outboundMessage?: {
    content: string;
    intent: "waitlist" | "alternatives" | "agent" | "unknown";
  };
}

export type IntakeStage = (p: IntakePayload) => Promise<IntakePayload>;

export interface IntakeStages {
  spam: IntakeStage;
  normalize: IntakeStage;
  dedup: IntakeStage;
  department: IntakeStage;
  tour: IntakeStage;
  assignment: IntakeStage;
  dispatch: IntakeStage;
}
