// src/modules/intake/normalize/index.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";

// Mock the AI provider used by field-map (proposeFieldMap) and language-detect.
// proposeFieldMap maps generic names; complete() returns "en".
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    completeJson: vi.fn().mockResolvedValue({
      full_name: "name",
      mobile: "phone",
      email_addr: "email",
    }),
    complete: vi.fn().mockResolvedValue("en"),
  }),
}));

import { normalize } from "./index";

const TENANTS = [
  "tenant-normalize-known",
  "tenant-normalize-unknown",
  "tenant-normalize-keydiff",
  "tenant-normalize-leak-a",
  "tenant-normalize-leak-b",
];

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

let adminIdSeq = 0;
async function ensureAdmin(tenantId: string): Promise<string> {
  const id = `admin-${tenantId}-${++adminIdSeq}`;
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      email: `${id}@x.com`,
      passwordHash: "x",
      name: "Admin",
      role: "COMPANY_ADMIN",
      isActive: true,
    },
  });
  return id;
}

async function clearAll() {
  await prisma.notification.deleteMany({ where: { tenantId: { in: TENANTS } } });
  await prisma.intakeForm.deleteMany({ where: { tenantId: { in: TENANTS } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: TENANTS } } });
  await redis.flushdb();
}

function makePayload(
  tenantId: string,
  overrides: Partial<IntakePayload> = {}
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-1",
    ...overrides,
  };
}

describe("normalize orchestrator", () => {
  beforeEach(async () => {
    for (const t of TENANTS) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("applies an existing confirmed fieldMap to produce canonicalFields", async () => {
    const tenantId = "tenant-normalize-known";
    const form = await prisma.intakeForm.create({
      data: {
        tenantId,
        source: "WEBSITE",
        externalId: "form-known-1",
        name: "Known Form",
        fieldMap: { full_name: "name", mobile: "phone", email_addr: "email" },
        fieldMappingConfirmed: true,
        status: "ACTIVE",
      },
    });

    const out = await normalize(
      makePayload(tenantId, {
        intakeFormId: form.id,
        rawPayload: {
          full_name: "Jane Doe",
          mobile: "+919999",
          email_addr: "jane@x.com",
        },
      })
    );

    expect(out.intakeFormId).toBe(form.id);
    expect(out.canonicalFields?.name).toBe("Jane Doe");
    expect(out.canonicalFields?.phone).toBe("+919999");
    expect(out.canonicalFields?.email).toBe("jane@x.com");

    // No unknown keys → no KEY_DIFF notification
    const notes = await prisma.notification.findMany({ where: { tenantId } });
    expect(notes).toHaveLength(0);
  });

  it("creates a PENDING_REVIEW IntakeForm and fans out notifications to all COMPANY_ADMINs on unknown source/externalId", async () => {
    const tenantId = "tenant-normalize-unknown";
    const admin1 = await ensureAdmin(tenantId);
    const admin2 = await ensureAdmin(tenantId);

    const out = await normalize(
      makePayload(tenantId, {
        source: "GOOGLE_FORMS",
        rawPayload: {
          _externalId: "gf-form-xyz",
          full_name: "Joe",
          mobile: "+91",
          email_addr: "joe@x.com",
        },
      })
    );

    // IntakeForm auto-created in PENDING_REVIEW
    expect(out.intakeFormId).toBeDefined();
    const form = await prisma.intakeForm.findUnique({
      where: { id: out.intakeFormId! },
    });
    expect(form).not.toBeNull();
    expect(form!.status).toBe("PENDING_REVIEW");
    expect(form!.fieldMappingConfirmed).toBe(false);
    expect(form!.externalId).toBe("gf-form-xyz");
    expect(form!.source).toBe("GOOGLE_FORMS");

    // Canonical fields produced from the AI-proposed map
    expect(out.canonicalFields?.name).toBe("Joe");
    expect(out.canonicalFields?.phone).toBe("+91");
    expect(out.canonicalFields?.email).toBe("joe@x.com");

    // One notification per active COMPANY_ADMIN
    const notes = await prisma.notification.findMany({
      where: { tenantId, type: "INTAKE_FORM_PENDING_REVIEW" },
    });
    expect(notes).toHaveLength(2);
    const userIds = notes.map((n) => n.userId).sort();
    expect(userIds).toEqual([admin1, admin2].sort());
  });

  it("does NOT apply an IntakeForm's field-map across tenants (intakeFormId from tenant A in tenant B's payload is ignored)", async () => {
    const tenantA = "tenant-normalize-leak-a";
    const tenantB = "tenant-normalize-leak-b";

    // Seed a confirmed form in tenant A with a working field-map.
    const formA = await prisma.intakeForm.create({
      data: {
        tenantId: tenantA,
        source: "WEBSITE",
        externalId: "form-leak-1",
        name: "Tenant A Form",
        fieldMap: { full_name: "name", mobile: "phone", email_addr: "email" },
        fieldMappingConfirmed: true,
        status: "ACTIVE",
      },
    });

    // Tenant B sends a payload that (maliciously or accidentally) carries
    // tenant A's intakeFormId. normalize must NOT resolve tenant A's form
    // and MUST NOT apply tenant A's field-map.
    const out = await normalize(
      makePayload(tenantB, {
        intakeFormId: formA.id,
        rawPayload: {
          full_name: "Bobby Tables",
          mobile: "+910000",
          email_addr: "bobby@x.com",
        },
      })
    );

    expect(out.intakeFormId).toBeUndefined();
    expect(out.canonicalFields?.name).toBeUndefined();
    expect(out.canonicalFields?.phone).toBeUndefined();
    expect(out.canonicalFields?.email).toBeUndefined();
  });

  it("raises a KEY_DIFF notification at most once per 24h when unknown keys appear", async () => {
    const tenantId = "tenant-normalize-keydiff";
    const admin = await ensureAdmin(tenantId);

    const form = await prisma.intakeForm.create({
      data: {
        tenantId,
        source: "WEBSITE",
        externalId: "form-keydiff-1",
        name: "KeyDiff Form",
        fieldMap: { full_name: "name" },
        fieldMappingConfirmed: true,
        status: "ACTIVE",
      },
    });

    // First call with an unknown key → 1 notification per admin
    await normalize(
      makePayload(tenantId, {
        intakeFormId: form.id,
        rawPayload: { full_name: "Joe", surprise_field: "x" },
      })
    );

    let notes = await prisma.notification.findMany({
      where: { tenantId, type: "INTAKE_FORM_KEY_DIFF" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(admin);

    // Second call within 24h with the same (or different) unknown key → no new notifications
    await normalize(
      makePayload(tenantId, {
        intakeFormId: form.id,
        rawPayload: { full_name: "Joe", another_field: "y" },
      })
    );

    notes = await prisma.notification.findMany({
      where: { tenantId, type: "INTAKE_FORM_KEY_DIFF" },
    });
    expect(notes).toHaveLength(1);
  });
});
