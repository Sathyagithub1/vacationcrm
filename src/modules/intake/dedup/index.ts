// src/modules/intake/dedup/index.ts
import type { IntakePayload } from "../types";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Strict-merge dedup (Phase 6a, stage 3 of the intake pipeline).
 *
 * Looks up the most recent Lead for the tenant whose Customer matches either
 * the incoming phone OR email. On match, appends a REPEAT_INQUIRY LeadActivity
 * and sets `dedupResult` on the payload so the pipeline orchestrator can
 * short-circuit before dispatch creates a duplicate Lead.
 *
 * Schema notes:
 *  - Canonical payload key is `phone`; the Customer column is `mobile`.
 *  - Customer.email is nullable (partial unique on tenant+email WHERE NOT NULL).
 *  - LeadActivity has no `source` or `meta` columns — contextual info goes
 *    into the single `content: Json` field.
 */
export async function dedupCheck(payload: IntakePayload): Promise<IntakePayload> {
  const mobile = payload.canonicalFields?.phone ?? payload.sender.phone;
  const email = payload.canonicalFields?.email ?? payload.sender.email;
  if (!mobile && !email) return payload;

  const orClauses: Prisma.CustomerWhereInput[] = [];
  if (mobile) orClauses.push({ mobile });
  if (email) orClauses.push({ email });

  const existing = await prisma.lead.findFirst({
    where: {
      tenantId: payload.tenantId,
      customer: { OR: orClauses },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!existing) return payload;

  await prisma.leadActivity.create({
    data: {
      tenantId: payload.tenantId,
      leadId: existing.id,
      type: "REPEAT_INQUIRY",
      content: {
        source: payload.source,
        rawPayload: payload.rawPayload as Prisma.InputJsonValue,
        intakeFormId: payload.intakeFormId ?? null,
      },
    },
  });

  return {
    ...payload,
    dedupResult: {
      existingLeadId: existing.id,
      existingCustomerId: existing.customerId,
    },
  };
}
