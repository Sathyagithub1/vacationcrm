// src/modules/intake/tour/matcher.ts

/**
 * Tour matcher (Phase 6a, T20) — stage 5 of the intake pipeline.
 *
 * Resolution strategy (two-tier):
 *
 *   1. Explicit code — if `canonicalFields.tourCode` is present, perform a
 *      compound-unique lookup (`tenantId_code`). On hit return immediately
 *      with `confidence: 1` and `soldOut` derived from the row's status.
 *      On miss fall through to tier 2.
 *
 *   2. AI catalog — load all ACTIVE and SOLD_OUT tours for the tenant (scoped
 *      to `departmentId` when set). If the catalog is empty, return the
 *      payload unchanged. Otherwise call `completeJson` with the catalog +
 *      `canonicalFields.notes` and accept the result only when:
 *        (a) `confidence >= 0.8`, AND
 *        (b) the returned `tourId` is in the loaded candidate list
 *            (anti-hallucination guard).
 *      On accept, merge the matched tour's `tagIds` into
 *      `canonicalFields.tags` (deduped). On AI error → fail-soft
 *      (console.warn including tenantId, return payload unchanged).
 *
 * SOLD_OUT tours are included in the AI candidate list intentionally — the
 * downstream orchestrator (T22) needs to detect sold-out matches so it can
 * trigger the waitlist flow.
 *
 * Schema gotchas:
 *   - Compound unique key: `prisma.tour.findUnique({ where: { tenantId_code: { tenantId, code } } })`
 *   - `TourStatus` enum values: DRAFT | ACTIVE | SOLD_OUT | CANCELLED | COMPLETED
 */

import type { IntakePayload } from "../types";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/modules/ai/provider";

const AI_CONFIDENCE_THRESHOLD = 0.8;

export async function matchTour(payload: IntakePayload): Promise<IntakePayload> {
  const { tenantId, canonicalFields, departmentId } = payload;
  const tourCode =
    typeof canonicalFields?.tourCode === "string"
      ? canonicalFields.tourCode.trim()
      : undefined;

  // ── Tier 1: Explicit tour code ──────────────────────────────────────────
  if (tourCode) {
    const tour = await prisma.tour.findUnique({
      where: { tenantId_code: { tenantId, code: tourCode } },
      select: { id: true, status: true, tagIds: true },
    });

    if (tour) {
      const soldOut = tour.status === "SOLD_OUT";
      const mergedTags = Array.from(
        new Set([...(canonicalFields?.tags ?? []), ...tour.tagIds])
      );
      return {
        ...payload,
        canonicalFields: { ...canonicalFields, tags: mergedTags },
        tourMatch: { tourId: tour.id, confidence: 1, soldOut },
      };
    }
    // No match — fall through to AI tier
  }

  // ── Tier 2: AI catalog ──────────────────────────────────────────────────
  const whereClause: {
    tenantId: string;
    status: { in: ("ACTIVE" | "SOLD_OUT")[] };
    departmentId?: string;
  } = {
    tenantId,
    status: { in: ["ACTIVE", "SOLD_OUT"] },
    ...(departmentId ? { departmentId } : {}),
  };

  const candidates = await prisma.tour.findMany({
    where: whereClause,
    select: { id: true, code: true, name: true, description: true, tagIds: true, status: true },
  });

  if (candidates.length === 0) return payload;

  const notes = String(canonicalFields?.notes ?? "").trim();
  if (!notes) return payload;

  try {
    const provider = await getAIProvider(tenantId);

    const catalog = candidates
      .map((t) =>
        t.description
          ? `- id: ${t.id}  code: ${t.code}  name: ${t.name}  description: ${t.description}  status: ${t.status}`
          : `- id: ${t.id}  code: ${t.code}  name: ${t.name}  status: ${t.status}`
      )
      .join("\n");

    const prompt = `You are a tour-matching assistant for a travel CRM. Given the customer inquiry below, identify the best matching tour from the catalog and return ONLY valid JSON in the shape {"tourId":"<id>","confidence":<0-1 float>}.

Tour catalog:
${catalog}

Customer inquiry:
${notes}`;

    const raw = await provider.completeJson(prompt);
    const result = raw as Record<string, unknown>;
    const aiTourId =
      typeof result?.tourId === "string" ? result.tourId : undefined;
    const confidence =
      typeof result?.confidence === "number" ? result.confidence : 0;

    // Anti-hallucination: tourId must be in the loaded candidate list
    const candidateIds = new Set(candidates.map((c) => c.id));

    if (aiTourId && confidence >= AI_CONFIDENCE_THRESHOLD && candidateIds.has(aiTourId)) {
      const matched = candidates.find((c) => c.id === aiTourId)!;
      const soldOut = matched.status === "SOLD_OUT";
      const mergedTags = Array.from(
        new Set([...(canonicalFields?.tags ?? []), ...matched.tagIds])
      );
      return {
        ...payload,
        canonicalFields: { ...canonicalFields, tags: mergedTags },
        tourMatch: { tourId: aiTourId, confidence, soldOut },
      };
    }
  } catch (err) {
    console.warn(
      `[matchTour][${tenantId}] AI catalog match failed, continuing without tour match: ${
        (err as Error).message
      }`
    );
  }

  return payload;
}
