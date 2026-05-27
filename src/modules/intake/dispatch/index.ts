// src/modules/intake/dispatch/index.ts

/**
 * Dispatch stage (Phase 6a, T31 — stage 6 of the intake pipeline).
 *
 * After spam/normalize/dedup/department/tour have run, dispatch is the first
 * stage that writes persistent rows.  It performs the following steps in order:
 *
 *   1. Short-circuit: if dedup hit `existingLeadId`, the lead already exists —
 *      return payload immediately without creating anything.
 *   2. Resolve the default PipelineStage for the tenant.  `Lead.stageId` is
 *      NOT NULL so we must have one.  Throws if none exist.
 *   3. Find-or-create Customer (race-safe: P2002 retry with `findFirst`).
 *   4. Create Lead with all resolved metadata fields.
 *   5. Open a Conversation tied to the lead and customer.  Maps `LeadSource`
 *      → `ConversationChannel` via an exhaustive switch so TypeScript catches
 *      any future enum additions at compile time.
 *   6. Write the initial customer message containing `canonicalFields.notes`
 *      (falls back to a truncated rawPayload JSON string if notes is absent).
 *   7. If `payload.outboundMessage` was staged by the tour orchestrator (T22)
 *      for a sold-out tour, write a second BOT message.
 *   8. Mark `IntakeWebhookLog.processed = true` with the new leadId.
 *   9. Return `{ ...payload, leadId: lead.id }`.
 *
 * Patterns enforced (same as Phase 8):
 *   - No `as any` casts
 *   - `findFirst` with tenantId on all global-UUID lookups (no cross-tenant leak)
 *   - Typed `Prisma.CustomerWhereInput[]` (no `filter(Boolean) as any`)
 *   - `e: unknown` + `Prisma.PrismaClientKnownRequestError` in P2002 handler
 *   - Tenant scope on every read and write
 */

import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import {
  Prisma,
  type LeadSource,
  type ConversationChannel,
  type LeadPriority,
} from "@prisma/client";

// ── LeadSource → ConversationChannel mapper ────────────────────────────────
//
// The two enums are NOT identical. This exhaustive switch lets TypeScript
// surface a compile error if a new LeadSource value is added without a
// corresponding mapping rule.  No `default` clause is intentional.

function leadSourceToConversationChannel(source: LeadSource): ConversationChannel {
  switch (source) {
    case "WHATSAPP":
      return "WHATSAPP";
    case "WEBSITE":
    case "WEBSITE_SNIPPET":
    case "FORM_BUILDER":
    case "GOOGLE_FORMS":
      return "WEBSITE";
    case "FB":
    case "META_LEAD_AD":
      return "FACEBOOK";
    case "IG":
      return "INSTAGRAM";
    case "EMAIL":
      return "EMAIL";
    case "MESSENGER":
      return "FACEBOOK";
    case "TELEGRAM":
      return "TELEGRAM";
    case "MANUAL":
      return "MANUAL";
  }
}

// ── Priority mapper ────────────────────────────────────────────────────────
//
// payload.priority is "LOW" | "NORMAL" | "HIGH" (set by T22 or earlier stages).
// Lead.priority is the DB enum: LOW | MEDIUM | HIGH | VIP.
// Mapping: LOW→LOW, NORMAL→MEDIUM, HIGH→HIGH.
// payload.priority takes precedence over tourMatch.soldOut (T22's value is
// more authoritative because it accounts for tagging + waitlist intent).

function resolveLeadPriority(
  payloadPriority: IntakePayload["priority"],
  soldOut: boolean,
): LeadPriority {
  if (payloadPriority === "HIGH") return "HIGH";
  if (payloadPriority === "LOW") return "LOW";
  if (soldOut) return "HIGH";
  // "NORMAL" or undefined → MEDIUM
  return "MEDIUM";
}

// ── Main dispatch function ─────────────────────────────────────────────────

export async function dispatch(payload: IntakePayload): Promise<IntakePayload> {
  // ── Step 1: Short-circuit on dedup hit ──────────────────────────────────
  if (payload.dedupResult?.existingLeadId) {
    return payload;
  }

  // ── Step 2: Resolve default PipelineStage ───────────────────────────────
  // Prefer isDefault:true; fall back to the stage with the lowest position.
  // Both queries are tenant-scoped.
  const defaultStage =
    (await prisma.pipelineStage.findFirst({
      where: { tenantId: payload.tenantId, isDefault: true },
      select: { id: true },
    })) ??
    (await prisma.pipelineStage.findFirst({
      where: { tenantId: payload.tenantId },
      orderBy: { position: "asc" },
      select: { id: true },
    }));

  if (!defaultStage) {
    throw new Error(
      `dispatch: no PipelineStage found for tenant ${payload.tenantId} — create at least one stage before processing intakes`,
    );
  }

  // ── Step 3: Resolve contact fields from canonical / sender ──────────────
  const mobile =
    payload.canonicalFields?.phone ?? payload.sender.phone ?? "";
  const email =
    payload.canonicalFields?.email ?? payload.sender.email ?? undefined;
  const name =
    payload.canonicalFields?.name ?? payload.sender.channelHandle ?? "Unknown";

  // ── Step 4: Resolve IntakeForm (tenant-scoped, no cross-tenant leak) ────
  const form = payload.intakeFormId
    ? await prisma.intakeForm.findFirst({
        where: { id: payload.intakeFormId, tenantId: payload.tenantId },
        select: { id: true, fieldMappingConfirmed: true },
      })
    : null;

  // needsFieldMapReview is true when the form exists but its field-map has
  // not yet been confirmed by an admin.
  const needsFieldMapReview =
    form !== null && form !== undefined && !form.fieldMappingConfirmed;

  // ── Step 5: Find or create Customer (race-safe via P2002 retry) ─────────
  // Build a typed OR clause — no filter(Boolean) as any.
  const orClauses: Prisma.CustomerWhereInput[] = [];
  if (mobile) orClauses.push({ mobile });
  if (email) orClauses.push({ email });

  let customer =
    orClauses.length > 0
      ? await prisma.customer.findFirst({
          where: { tenantId: payload.tenantId, OR: orClauses },
          select: { id: true },
        })
      : null;

  if (!customer) {
    try {
      customer = await prisma.customer.create({
        data: {
          tenantId: payload.tenantId,
          name,
          mobile: mobile || `unknown-${Date.now()}`,
          email: email ?? null,
        },
        select: { id: true },
      });
    } catch (e: unknown) {
      // P2002 = unique constraint violation — a concurrent request created the
      // same customer between our findFirst and our create. Re-fetch.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const refetched =
          orClauses.length > 0
            ? await prisma.customer.findFirst({
                where: { tenantId: payload.tenantId, OR: orClauses },
                select: { id: true },
              })
            : null;
        if (!refetched) throw e; // Should not happen — just re-throw
        customer = refetched;
      } else {
        throw e;
      }
    }
  }

  // ── Step 6: Resolve priority ─────────────────────────────────────────────
  const leadPriority = resolveLeadPriority(
    payload.priority,
    payload.tourMatch?.soldOut ?? false,
  );

  // ── Step 7: Create Lead ──────────────────────────────────────────────────
  const lead = await prisma.lead.create({
    data: {
      tenantId: payload.tenantId,
      customerId: customer.id,
      stageId: defaultStage.id,
      source: payload.source,
      priority: leadPriority,
      language: payload.canonicalFields?.language ?? null,
      tourId: payload.tourMatch?.tourId ?? null,
      intakeFormId: form?.id ?? null,
      departmentId: payload.departmentId ?? null,
      needsFieldMapReview,
    },
    select: { id: true },
  });

  // ── Step 8: Open Conversation ────────────────────────────────────────────
  const channel = leadSourceToConversationChannel(payload.source);
  const conv = await prisma.conversation.create({
    data: {
      tenantId: payload.tenantId,
      leadId: lead.id,
      customerId: customer.id,
      channel,
    },
    select: { id: true },
  });

  // ── Step 9: Write initial customer message ───────────────────────────────
  // Use canonicalFields.notes as content; fall back to a truncated JSON dump
  // of rawPayload so there is always something human-readable in the thread.
  const initialContent =
    payload.canonicalFields?.notes ??
    JSON.stringify(payload.rawPayload).slice(0, 500);

  await prisma.message.create({
    data: {
      tenantId: payload.tenantId,
      conversationId: conv.id,
      senderType: "CUSTOMER",
      content: initialContent,
      messageType: "TEXT",
    },
  });

  // ── Step 10: Write staged outbound message (T22 sold-out flow) ────────────
  if (payload.outboundMessage) {
    await prisma.message.create({
      data: {
        tenantId: payload.tenantId,
        conversationId: conv.id,
        senderType: "BOT",
        content: payload.outboundMessage.content,
        messageType: "TEXT",
      },
    });
  }

  // ── Step 11: Mark IntakeWebhookLog as processed ──────────────────────────
  await prisma.intakeWebhookLog.update({
    where: { id: payload.webhookLogId },
    data: { processed: true, leadId: lead.id },
  });

  return { ...payload, leadId: lead.id };
}
