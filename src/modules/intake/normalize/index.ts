// src/modules/intake/normalize/index.ts
import type { IntakePayload } from "../types";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import {
  applyFieldMap,
  detectUnknownKeys,
  proposeFieldMap,
} from "./field-map";
import { detectLanguage } from "./language-detect";

/**
 * Layer 1 of the intake pipeline (Phase 6a). Looks up the `IntakeForm`
 * referenced by the payload — or auto-creates one in `PENDING_REVIEW` when
 * the payload carries an `_externalId` for a source/externalId combo we've
 * never seen — applies the form's field-map to derive canonical fields,
 * runs language detection over the message text, and raises debounced
 * `INTAKE_FORM_KEY_DIFF` notifications when a confirmed form starts
 * receiving unknown keys.
 *
 * Notifications fan out to ALL active `COMPANY_ADMIN` users for the tenant
 * (the `Notification.userId` column is NOT NULL). The KEY_DIFF
 * notification is debounced per IntakeForm via a Redis key
 * `intake:keydiff:<formId>` with EX=86400 NX so admins aren't spammed by
 * every payload that includes the new field.
 */
export async function normalize(
  payload: IntakePayload
): Promise<IntakePayload> {
  // 1. Identify the IntakeForm. Tenant-scoped lookup: IntakeForm.id is a
  //    global UUID, so findUnique by id alone would resolve forms across
  //    tenants. We use findFirst with a compound (id, tenantId) filter to
  //    prevent a cross-tenant payload from picking up another tenant's
  //    field-map.
  let form = payload.intakeFormId
    ? await prisma.intakeForm.findFirst({
        where: { id: payload.intakeFormId, tenantId: payload.tenantId },
      })
    : null;

  // 2. Auto-create + raise PENDING_REVIEW notification when the payload
  //    advertises an externalId but no IntakeForm exists yet.
  const externalIdRaw = (payload.rawPayload as Record<string, unknown>)
    ._externalId;
  if (!form && externalIdRaw !== undefined && externalIdRaw !== null) {
    const externalId = String(externalIdRaw);
    let proposed: Record<string, string> = {};
    try {
      proposed = await proposeFieldMap(payload.tenantId, payload.rawPayload);
    } catch (e) {
      // Don't block intake on AI failure — the admin will fix the map manually.
      console.warn(
        `[normalize] proposeFieldMap failed, creating IntakeForm with empty map: ${
          (e as Error).message
        }`
      );
    }
    form = await prisma.intakeForm.create({
      data: {
        tenantId: payload.tenantId,
        source: payload.source,
        externalId,
        name: `Auto: ${payload.source} ${externalId.slice(0, 12)}`,
        fieldMap: proposed,
        fieldMappingConfirmed: false,
        status: "PENDING_REVIEW",
      },
    });

    const admins = await prisma.user.findMany({
      where: {
        tenantId: payload.tenantId,
        role: "COMPANY_ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        prisma.notification.create({
          data: {
            tenantId: payload.tenantId,
            userId: a.id,
            type: "INTAKE_FORM_PENDING_REVIEW",
            title: "New form awaiting field-map review",
            body: `Auto-created IntakeForm for source ${payload.source} needs field-map confirmation.`,
            data: {
              intakeFormId: form!.id,
              source: payload.source,
              externalId,
            },
          },
        })
      )
    );
  }

  // 3. Apply field-map (empty when no form was resolved — canonical stays empty).
  const map: Record<string, string> =
    (form?.fieldMap as Record<string, string> | null) ?? {};
  const canonical: Record<string, unknown> = applyFieldMap(
    payload.rawPayload,
    map
  );

  // 4. Seed default tags from the form (if any).
  if (form?.defaultTagIds?.length) {
    canonical.tags = [...form.defaultTagIds];
  }

  // 5. Language detection over the message text. `notes` is the canonical
  //    slot; fall back to a raw `message` field if present.
  const textForLang = String(
    canonical.notes ??
      (payload.rawPayload as Record<string, unknown>).message ??
      ""
  );
  const lang = await detectLanguage(payload.tenantId, textForLang);
  if (lang) canonical.language = lang;

  // 6. Debounced KEY_DIFF notification for confirmed forms that start
  //    receiving previously-unmapped keys.
  if (form?.fieldMappingConfirmed) {
    const unknown = detectUnknownKeys(payload.rawPayload, map);
    if (unknown.length) {
      const dbKey = `intake:keydiff:${form.id}`;
      const setRecently = await redis.set(dbKey, "1", "EX", 86400, "NX");
      if (setRecently === "OK") {
        const admins = await prisma.user.findMany({
          where: {
            tenantId: payload.tenantId,
            role: "COMPANY_ADMIN",
            isActive: true,
          },
          select: { id: true },
        });
        await Promise.all(
          admins.map((a) =>
            prisma.notification.create({
              data: {
                tenantId: payload.tenantId,
                userId: a.id,
                type: "INTAKE_FORM_KEY_DIFF",
                title: `New keys on ${form!.name}`,
                body: `Unknown keys received: ${unknown.join(
                  ", "
                )}. Review and update field-map.`,
                data: { intakeFormId: form!.id, unknown },
              },
            })
          )
        );
      }
    }
  }

  return {
    ...payload,
    intakeFormId: form?.id,
    canonicalFields: canonical as IntakePayload["canonicalFields"],
  };
}
