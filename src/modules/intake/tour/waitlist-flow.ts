// src/modules/intake/tour/waitlist-flow.ts

/**
 * Waitlist mini-flow (Phase 6a, T22) — invoked by the tour orchestrator when a
 * sold-out tour match is detected.
 *
 * Generates a templated outbound message that the downstream dispatch stage
 * (T31, future) will write to the Conversation/Message infra after creating
 * the Lead. We do NOT write any Conversation or Message rows here — the tour
 * stage runs before dispatch, so `leadId` does not exist yet.
 *
 * The returned `{ content, intent }` object is staged on
 * `payload.outboundMessage` by the orchestrator.
 *
 * Intent values:
 *   "waitlist"     — offered a place on the waitlist for the sold-out tour
 *   "alternatives" — suggested alternative tours
 *   "agent"        — escalated to a human agent for manual handling
 *   "unknown"      — AI could not determine the right response
 *
 * Fail-soft: on AI error OR malformed JSON (missing content/intent) → return
 * null. The orchestrator handles graceful degradation (still sets priority
 * HIGH and sold-out tag, just without the outbound message).
 */

import type { IntakePayload } from "../types";
import { getAIProvider } from "@/modules/ai/provider";

type WaitlistIntent = "waitlist" | "alternatives" | "agent" | "unknown";

export interface WaitlistMessage {
  content: string;
  intent: WaitlistIntent;
}

export async function waitlistFlow(
  payload: IntakePayload,
  tour: { id: string; name: string; code: string }
): Promise<WaitlistMessage | null> {
  const { tenantId, canonicalFields } = payload;
  const customerName = String(canonicalFields?.name ?? "the customer");
  const notes = String(canonicalFields?.notes ?? "");

  try {
    const provider = await getAIProvider(tenantId);

    const prompt = `You are a customer-service assistant for a travel CRM.

The customer requested the tour "${tour.name}" (code: ${tour.code}), but it is currently SOLD OUT.

Customer name: ${customerName}
Customer inquiry: ${notes || "(no additional notes)"}

Generate a polite, empathetic response message to send to the customer. Choose the most appropriate strategy:
  - "waitlist": offer to place them on the waitlist for this tour
  - "alternatives": suggest they enquire about alternative available tours
  - "agent": escalate to a human agent because the inquiry is complex
  - "unknown": if you cannot determine the right strategy

Return ONLY valid JSON in the shape:
{"content":"<message text>","intent":"<waitlist|alternatives|agent|unknown>"}`;

    const raw = await provider.completeJson(prompt);
    const result = raw as Record<string, unknown>;

    const content = typeof result?.content === "string" ? result.content.trim() : undefined;
    const intent = typeof result?.intent === "string" ? result.intent : undefined;

    const validIntents: WaitlistIntent[] = ["waitlist", "alternatives", "agent", "unknown"];
    if (!content || !intent || !validIntents.includes(intent as WaitlistIntent)) {
      // Malformed JSON — fail-soft
      console.warn(
        `[waitlistFlow][${tenantId}] AI returned malformed response for tour ${tour.id}: missing or invalid content/intent`
      );
      return null;
    }

    return { content, intent: intent as WaitlistIntent };
  } catch (err) {
    console.warn(
      `[waitlistFlow][${tenantId}] AI call failed for sold-out tour ${tour.id}: ${
        (err as Error).message
      }`
    );
    return null;
  }
}
