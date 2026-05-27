// src/modules/intake/department/index.ts
import type { IntakePayload } from "../types";
import { prisma } from "@/lib/prisma";
import { getAIProvider } from "@/modules/ai/provider";

/**
 * Department resolver (Phase 6a, stage 4 of the intake pipeline).
 *
 * Resolves which Department a new intake should be routed to using a
 * three-tier strategy, evaluated in order:
 *
 *   1. Explicit — if `canonicalFields.department_id` or
 *      `rawPayload.department_id` is set and matches an active Department for
 *      the tenant, use it directly.
 *
 *   2. IntakeForm fallback — if the payload references an IntakeForm that has
 *      a `departmentId` set, use that.
 *
 *   3. AI fallback — load all active Departments for the tenant, ask the AI
 *      provider to classify `canonicalFields.notes` into the best department.
 *      Accept the result only if:
 *        (a) the returned `departmentId` is one of the tenant's active depts, AND
 *        (b) `confidence >= 0.5`.
 *      On any error, unknown dept, or low confidence → leave `departmentId`
 *      unset (fail-soft; intake continues without a department).
 *
 * If none of the tiers resolve a department, `payload.departmentId` is left
 * undefined and downstream stages (dispatch / assignment) handle routing
 * without a department constraint.
 */
export async function resolveDepartment(
  payload: IntakePayload
): Promise<IntakePayload> {
  // ── Tier 1: Explicit department_id in canonical or raw payload ──────────
  const canonicalRaw = payload.canonicalFields as
    | Record<string, unknown>
    | undefined;

  const explicitId =
    typeof canonicalRaw?.department_id === "string"
      ? canonicalRaw.department_id
      : typeof payload.rawPayload?.department_id === "string"
        ? payload.rawPayload.department_id
        : undefined;

  if (explicitId) {
    const dept = await prisma.department.findFirst({
      where: { id: explicitId, tenantId: payload.tenantId, isActive: true },
      select: { id: true },
    });
    if (dept) {
      return { ...payload, departmentId: dept.id };
    }
  }

  // ── Tier 2: IntakeForm's departmentId ────────────────────────────────────
  if (payload.intakeFormId) {
    const form = await prisma.intakeForm.findFirst({
      where: { id: payload.intakeFormId, tenantId: payload.tenantId },
      select: { departmentId: true },
    });
    if (form?.departmentId) {
      return { ...payload, departmentId: form.departmentId };
    }
  }

  // ── Tier 3: AI classification over notes ─────────────────────────────────
  const activeDepts = await prisma.department.findMany({
    where: { tenantId: payload.tenantId, isActive: true },
    select: { id: true, name: true, description: true },
  });

  if (activeDepts.length === 0) return payload; // nothing to classify into

  const notes = String(payload.canonicalFields?.notes ?? "");
  if (!notes.trim()) return payload; // no text to classify

  try {
    const provider = await getAIProvider(payload.tenantId);
    const deptList = activeDepts
      .map((d) =>
        d.description
          ? `- id: ${d.id}  name: ${d.name}  description: ${d.description}`
          : `- id: ${d.id}  name: ${d.name}`
      )
      .join("\n");

    const prompt = `You are a routing assistant for a travel CRM. Given the customer inquiry below, pick the best department from the list and return ONLY valid JSON in the shape {"departmentId":"<id>","confidence":<0-1 float>}.

Departments:
${deptList}

Customer inquiry:
${notes}`;

    const raw = await provider.completeJson(prompt);
    const result = raw as Record<string, unknown>;
    const aiDeptId = typeof result?.departmentId === "string" ? result.departmentId : undefined;
    const confidence = typeof result?.confidence === "number" ? result.confidence : 0;

    if (
      aiDeptId &&
      confidence >= 0.5 &&
      activeDepts.some((d) => d.id === aiDeptId)
    ) {
      return { ...payload, departmentId: aiDeptId };
    }
  } catch (err) {
    console.warn(
      `[resolveDepartment][${payload.tenantId}] AI classification failed, continuing without department: ${
        (err as Error).message
      }`
    );
  }

  return payload;
}
