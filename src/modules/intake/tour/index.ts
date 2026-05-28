// src/modules/intake/tour/index.ts

/**
 * Tour stage orchestrator (Phase 6a, T22) — stage 5 of the intake pipeline.
 *
 * Orchestrates the tour-matching and sold-out handling flow:
 *
 *   1. Call `matchTour` (T20) to resolve a tour from the explicit tourCode or
 *      AI catalog.
 *   2. No match → return payload unchanged.
 *   3. Match, tour is NOT sold out → return payload with tourMatch set.
 *   4. Match, tour IS sold out:
 *      a. Append "sold-out" to `canonicalFields.tags` (deduped).
 *      b. Set `priority: "HIGH"` to signal urgent handling to dispatch/assignment.
 *      c. Call `waitlistFlow` to generate an outbound message.
 *      d. If waitlistFlow returns a result, stage it on `payload.outboundMessage`.
 *         If it returns null (AI failure), degrade gracefully — we still set the
 *         tag and priority, outboundMessage simply remains undefined.
 *
 * IMPORTANT: This stage does NOT write any Conversation or Message rows.
 * `leadId` does not exist yet — dispatch (T31) will create the Lead and
 * Conversation, then read `payload.outboundMessage` to write the actual message.
 */

import type { IntakePayload } from "../types";
import { matchTour } from "./matcher";
import { waitlistFlow } from "./waitlist-flow";
import { prisma } from "@/lib/prisma";

export async function processTour(payload: IntakePayload): Promise<IntakePayload> {
  // Step 1: resolve tour match
  let p = await matchTour(payload);

  // Step 2: no match → pass through
  if (!p.tourMatch) return p;

  // Step 3: match, not sold out → return as-is (tourMatch already on payload)
  if (!p.tourMatch.soldOut) return p;

  // Step 4: sold-out tour — enrich payload
  const { tenantId, canonicalFields } = p;
  const matchedTourId = p.tourMatch.tourId; // capture before spread (TS narrowing)

  // 4a. Tag sold-out
  const existingTags = canonicalFields?.tags ?? [];
  const tags = Array.from(new Set([...existingTags, "sold-out"]));

  // 4b. Priority HIGH
  p = {
    ...p,
    priority: "HIGH",
    canonicalFields: { ...canonicalFields, tags },
  };

  // 4c-d. Generate waitlist message (fail-soft)
  try {
    // Look up the tour name/code for the waitlist prompt
    const tour = await prisma.tour.findUnique({
      where: { id: matchedTourId },
      select: { id: true, name: true, code: true },
    });

    if (tour) {
      const msg = await waitlistFlow(p, tour);
      if (msg) {
        p = { ...p, outboundMessage: msg };
      }
    }
  } catch (err) {
    console.warn(
      `[processTour][${tenantId}] waitlistFlow lookup/call failed, continuing without outbound message: ${
        (err as Error).message
      }`
    );
  }

  return p;
}
