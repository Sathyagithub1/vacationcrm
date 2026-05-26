// src/modules/intake/pipeline.ts
import type { IntakePayload, IntakeStages } from './types';

export async function runPipeline(payload: IntakePayload, stages: IntakeStages): Promise<IntakePayload> {
  let p = await stages.spam(payload);
  if (p.spamCheck && !p.spamCheck.passed) return p;

  p = await stages.normalize(p);

  p = await stages.dedup(p);
  if (p.dedupResult?.existingLeadId) return p; // duplicate — REPEAT_INQUIRY activity already appended

  p = await stages.department(p);
  p = await stages.tour(p);
  p = await stages.dispatch(p);   // creates Lead/Conversation, sets p.leadId
  p = await stages.assignment(p); // requires p.leadId — assigns to agent
  return p;
}
