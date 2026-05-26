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
