// src/modules/intake/dispatch/index.test.ts

/**
 * Integration tests for the dispatch stage (Phase 6a, T31).
 *
 * Uses real DB operations against the test Postgres instance — no Prisma
 * mocks.  Each test gets one tenant with isolated IDs to prevent bleed.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";
import { dispatch } from "./index";

// ── Tenant constants (one per test to guarantee isolation) ────────────────
const T_DEDUP = "t-disp-dedup";          // 1: short-circuit on dedup hit
const T_HAPPY = "t-disp-happy";          // 2: happy path
const T_CUST_REUSE = "t-disp-custruse"; // 3: customer find (reuse existing)
const T_REVIEW = "t-disp-review";        // 4: needsFieldMapReview
const T_SOLD = "t-disp-sold";            // 5: tour sold-out priority
const T_PRIO = "t-disp-prio";            // 6: payload.priority HIGH override
const T_OUTBOUND = "t-disp-outbound";    // 7: outboundMessage written
const T_NOSTAGE = "t-disp-nostage";      // 8: no stages → throws
const T_XFORM_A = "t-disp-xform-a";     // 9a: cross-tenant IntakeForm owner
const T_XFORM_B = "t-disp-xform-b";     // 9b: other tenant that tries to use it
const T_SRCMAP = "t-disp-srcmap";        // 10: source-to-channel mapping

const ALL_TENANTS = [
  T_DEDUP,
  T_HAPPY,
  T_CUST_REUSE,
  T_REVIEW,
  T_SOLD,
  T_PRIO,
  T_OUTBOUND,
  T_NOSTAGE,
  T_XFORM_A,
  T_XFORM_B,
  T_SRCMAP,
];

// ── Helpers ───────────────────────────────────────────────────────────────

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function seedStage(tenantId: string, opts: { isDefault?: boolean; position?: number } = {}): Promise<string> {
  const id = `stage-disp-${tenantId}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      name: "New",
      slug: "new",
      position: opts.position ?? 1,
      isDefault: opts.isDefault ?? true,
    },
  });
  return id;
}

async function seedWebhookLog(tenantId: string, id: string) {
  await prisma.intakeWebhookLog.upsert({
    where: { id },
    update: { processed: false, leadId: null },
    create: {
      id,
      tenantId,
      source: "WEBSITE",
      endpoint: "/api/intake/test",
      rawPayload: {},
      signatureValid: true,
      processed: false,
    },
  });
}

async function seedIntakeForm(opts: {
  id: string;
  tenantId: string;
  fieldMappingConfirmed: boolean;
}): Promise<string> {
  await prisma.intakeForm.upsert({
    where: { id: opts.id },
    update: {},
    create: {
      id: opts.id,
      tenantId: opts.tenantId,
      source: "WEBSITE",
      externalId: opts.id,
      name: `Form ${opts.id}`,
      fieldMap: {},
      fieldMappingConfirmed: opts.fieldMappingConfirmed,
    },
  });
  return opts.id;
}

async function clearTenant(tenantId: string) {
  // Delete in dependency order (children before parents)
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.leadActivity.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.intakeForm.deleteMany({ where: { tenantId } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId } });
  // Tours must be deleted before departments (tours_department_id_fkey)
  await prisma.tour.deleteMany({ where: { tenantId } });
  await prisma.department.deleteMany({ where: { tenantId } });
}

function makePayload(
  tenantId: string,
  webhookLogId: string,
  overrides: Partial<IntakePayload> = {},
): IntakePayload {
  return {
    tenantId,
    source: "WEBSITE",
    rawPayload: { raw: "test" },
    sender: { phone: "+919876543210" },
    webhookLogId,
    canonicalFields: {
      name: "Test Customer",
      phone: "+919876543210",
      notes: "I want to book a tour",
    },
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────

beforeEach(async () => {
  for (const t of ALL_TENANTS) await ensureTenant(t);
  for (const t of ALL_TENANTS) await clearTenant(t);
});

afterAll(async () => {
  for (const t of ALL_TENANTS) await clearTenant(t);
  await prisma.$disconnect();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("dispatch stage (T31)", () => {

  // ── Test 1: Short-circuit on dedup hit ──────────────────────────────────
  it("short-circuit: dedupResult.existingLeadId set → returns payload unchanged, no rows created", async () => {
    await seedStage(T_DEDUP);
    await seedWebhookLog(T_DEDUP, "wh-disp-dedup");

    const payload = makePayload(T_DEDUP, "wh-disp-dedup", {
      dedupResult: { existingLeadId: "existing-lead-id" },
    });

    const out = await dispatch(payload);

    // Must return payload unchanged (leadId not set by dispatch)
    expect(out.leadId).toBeUndefined();
    expect(out.dedupResult?.existingLeadId).toBe("existing-lead-id");

    // No Customer, Lead, Conversation, or Message must have been created
    const customers = await prisma.customer.findMany({ where: { tenantId: T_DEDUP } });
    expect(customers).toHaveLength(0);
    const leads = await prisma.lead.findMany({ where: { tenantId: T_DEDUP } });
    expect(leads).toHaveLength(0);
    const convs = await prisma.conversation.findMany({ where: { tenantId: T_DEDUP } });
    expect(convs).toHaveLength(0);
    const msgs = await prisma.message.findMany({ where: { tenantId: T_DEDUP } });
    expect(msgs).toHaveLength(0);
  });

  // ── Test 2: Happy path ──────────────────────────────────────────────────
  it("happy path: creates Customer, Lead, Conversation, Message; marks webhook log processed; returns leadId", async () => {
    await seedStage(T_HAPPY);
    await seedWebhookLog(T_HAPPY, "wh-disp-happy");

    const payload = makePayload(T_HAPPY, "wh-disp-happy", {
      canonicalFields: {
        name: "Alice",
        phone: "+911234567890",
        email: "alice@example.com",
        notes: "Interested in Bali tour",
      },
    });

    const out = await dispatch(payload);

    // leadId must be set
    expect(out.leadId).toBeDefined();
    expect(typeof out.leadId).toBe("string");

    // Customer must exist
    const customer = await prisma.customer.findFirst({
      where: { tenantId: T_HAPPY, mobile: "+911234567890" },
    });
    expect(customer).not.toBeNull();
    expect(customer?.email).toBe("alice@example.com");

    // Lead must exist with correct fields
    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead).not.toBeNull();
    expect(lead?.tenantId).toBe(T_HAPPY);
    expect(lead?.customerId).toBe(customer!.id);
    expect(lead?.source).toBe("WEBSITE");

    // Conversation must exist
    const conv = await prisma.conversation.findFirst({
      where: { tenantId: T_HAPPY, leadId: out.leadId },
    });
    expect(conv).not.toBeNull();
    expect(conv?.channel).toBe("WEBSITE");

    // Initial customer message must exist
    const msgs = await prisma.message.findMany({
      where: { tenantId: T_HAPPY, conversationId: conv!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderType).toBe("CUSTOMER");
    expect(msgs[0].content).toBe("Interested in Bali tour");

    // Webhook log must be marked processed
    const log = await prisma.intakeWebhookLog.findUnique({ where: { id: "wh-disp-happy" } });
    expect(log?.processed).toBe(true);
    expect(log?.leadId).toBe(out.leadId);
  });

  // ── Test 3: Customer reuse ──────────────────────────────────────────────
  it("customer find: existing Customer with matching mobile → reused, no new Customer created", async () => {
    await seedStage(T_CUST_REUSE);
    await seedWebhookLog(T_CUST_REUSE, "wh-disp-custruse");

    // Pre-seed a customer
    const existing = await prisma.customer.create({
      data: {
        tenantId: T_CUST_REUSE,
        name: "Bob Existing",
        mobile: "+911111111111",
      },
    });

    const payload = makePayload(T_CUST_REUSE, "wh-disp-custruse", {
      canonicalFields: {
        name: "Bob New Inquiry",
        phone: "+911111111111",
        notes: "Want more info",
      },
    });

    const out = await dispatch(payload);

    expect(out.leadId).toBeDefined();

    // Still only one customer with this mobile
    const customers = await prisma.customer.findMany({
      where: { tenantId: T_CUST_REUSE, mobile: "+911111111111" },
    });
    expect(customers).toHaveLength(1);
    expect(customers[0].id).toBe(existing.id);

    // Lead must reference existing customer
    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.customerId).toBe(existing.id);
  });

  // ── Test 4: needsFieldMapReview ─────────────────────────────────────────
  it("needsFieldMapReview: IntakeForm with fieldMappingConfirmed=false → Lead.needsFieldMapReview=true", async () => {
    await seedStage(T_REVIEW);
    await seedWebhookLog(T_REVIEW, "wh-disp-review");
    const formId = await seedIntakeForm({
      id: "form-disp-review",
      tenantId: T_REVIEW,
      fieldMappingConfirmed: false,
    });

    const payload = makePayload(T_REVIEW, "wh-disp-review", {
      intakeFormId: formId,
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.needsFieldMapReview).toBe(true);
    expect(lead?.intakeFormId).toBe(formId);
  });

  it("needsFieldMapReview: IntakeForm with fieldMappingConfirmed=true → Lead.needsFieldMapReview=false", async () => {
    await seedStage(T_REVIEW);
    await seedWebhookLog(T_REVIEW, "wh-disp-review-2");
    const formId = await seedIntakeForm({
      id: "form-disp-review-confirmed",
      tenantId: T_REVIEW,
      fieldMappingConfirmed: true,
    });

    const payload = makePayload(T_REVIEW, "wh-disp-review-2", {
      intakeFormId: formId,
      canonicalFields: {
        phone: "+910000000099",
        name: "Test",
        notes: "confirmed form test",
      },
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.needsFieldMapReview).toBe(false);
  });

  // ── Test 5: Tour sold-out priority ──────────────────────────────────────
  it("tour sold-out: tourMatch.soldOut=true → Lead.priority=HIGH", async () => {
    await seedStage(T_SOLD);
    await seedWebhookLog(T_SOLD, "wh-disp-sold");

    // Seed a department and a sold-out tour
    await prisma.department.upsert({
      where: { id: "dept-disp-sold" },
      update: {},
      create: { id: "dept-disp-sold", tenantId: T_SOLD, name: "Tours", slug: "tours" },
    });
    const tourId = "tour-disp-sold";
    await prisma.tour.upsert({
      where: { id: tourId },
      update: {},
      create: {
        id: tourId,
        tenantId: T_SOLD,
        code: "SOLD-TEST",
        name: "Sold Out Tour",
        description: "A sold out tour",
        departmentId: "dept-disp-sold",
        startDate: new Date("2027-06-01"),
        endDate: new Date("2027-06-08"),
        capacity: 10,
        sold: 10,
        status: "SOLD_OUT",
        tagIds: [],
      },
    });

    const payload = makePayload(T_SOLD, "wh-disp-sold", {
      tourMatch: { tourId, confidence: 0.9, soldOut: true },
      // priority NOT set by payload — only tourMatch.soldOut
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.priority).toBe("HIGH");
    expect(lead?.tourId).toBe(tourId);
  });

  // ── Test 6: payload.priority override ──────────────────────────────────
  it("payload.priority=HIGH overrides tourMatch.soldOut logic, Lead.priority=HIGH", async () => {
    await seedStage(T_PRIO);
    await seedWebhookLog(T_PRIO, "wh-disp-prio");

    const payload = makePayload(T_PRIO, "wh-disp-prio", {
      priority: "HIGH",
      // tourMatch not set — only payload.priority drives HIGH
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.priority).toBe("HIGH");
  });

  it("payload.priority=LOW → Lead.priority=LOW", async () => {
    await seedStage(T_PRIO);
    await seedWebhookLog(T_PRIO, "wh-disp-prio-low");

    const payload = makePayload(T_PRIO, "wh-disp-prio-low", {
      priority: "LOW",
      canonicalFields: {
        phone: "+910000000088",
        name: "Low Prio Test",
        notes: "low prio test",
      },
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.priority).toBe("LOW");
  });

  it("no priority set, no soldOut → Lead.priority=MEDIUM (default)", async () => {
    await seedStage(T_PRIO);
    await seedWebhookLog(T_PRIO, "wh-disp-prio-medium");

    const payload = makePayload(T_PRIO, "wh-disp-prio-medium", {
      canonicalFields: {
        phone: "+910000000077",
        name: "Medium Prio Test",
        notes: "medium prio test",
      },
    });

    const out = await dispatch(payload);

    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead?.priority).toBe("MEDIUM");
  });

  // ── Test 7: outboundMessage gets written as BOT message ─────────────────
  it("outboundMessage staged by T22 → second Message with senderType=BOT and correct content", async () => {
    await seedStage(T_OUTBOUND);
    await seedWebhookLog(T_OUTBOUND, "wh-disp-outbound");

    const outboundContent = "We are sorry, this tour is sold out. We can add you to the waitlist.";

    const payload = makePayload(T_OUTBOUND, "wh-disp-outbound", {
      outboundMessage: { content: outboundContent, intent: "waitlist" },
      canonicalFields: {
        phone: "+910000000066",
        name: "Waitlist Customer",
        notes: "I want the sold-out tour",
      },
    });

    const out = await dispatch(payload);

    const conv = await prisma.conversation.findFirst({
      where: { tenantId: T_OUTBOUND, leadId: out.leadId },
    });
    expect(conv).not.toBeNull();

    const msgs = await prisma.message.findMany({
      where: { tenantId: T_OUTBOUND, conversationId: conv!.id },
      orderBy: { createdAt: "asc" },
    });

    // First message: customer's initial message
    expect(msgs).toHaveLength(2);
    expect(msgs[0].senderType).toBe("CUSTOMER");
    expect(msgs[0].content).toBe("I want the sold-out tour");

    // Second message: bot's staged outbound response
    expect(msgs[1].senderType).toBe("BOT");
    expect(msgs[1].content).toBe(outboundContent);
  });

  // ── Test 8: No stages → throws ──────────────────────────────────────────
  it("no PipelineStage rows for tenant → throws with tenantId in error message", async () => {
    await seedWebhookLog(T_NOSTAGE, "wh-disp-nostage");
    // NOTE: intentionally no seedStage() call

    const payload = makePayload(T_NOSTAGE, "wh-disp-nostage");

    await expect(dispatch(payload)).rejects.toThrow(T_NOSTAGE);
  });

  // ── Test 9: Cross-tenant IntakeForm guard ───────────────────────────────
  it("cross-tenant IntakeForm guard: form belongs to tenant A, payload from tenant B → form not resolved, Lead.intakeFormId=null, needsFieldMapReview=false", async () => {
    // Seed tenant A's form (fieldMappingConfirmed=false so it WOULD set needsFieldMapReview if cross-tenant)
    await seedStage(T_XFORM_A);
    const formId = await seedIntakeForm({
      id: "form-disp-tenant-a",
      tenantId: T_XFORM_A,
      fieldMappingConfirmed: false,
    });

    // Seed tenant B's stage and webhook log
    await seedStage(T_XFORM_B);
    await seedWebhookLog(T_XFORM_B, "wh-disp-xform-b");

    // Tenant B payload references tenant A's form
    const payload = makePayload(T_XFORM_B, "wh-disp-xform-b", {
      intakeFormId: formId, // belongs to T_XFORM_A, not T_XFORM_B
      canonicalFields: {
        phone: "+910000000055",
        name: "Cross Tenant Test",
        notes: "cross tenant form test",
      },
    });

    const out = await dispatch(payload);

    // Lead must be created for tenant B
    const lead = await prisma.lead.findUnique({ where: { id: out.leadId! } });
    expect(lead).not.toBeNull();
    expect(lead?.tenantId).toBe(T_XFORM_B);

    // Cross-tenant form must NOT be resolved
    expect(lead?.intakeFormId).toBeNull();
    expect(lead?.needsFieldMapReview).toBe(false);
  });

  // ── Test 10: LeadSource → ConversationChannel mapping ───────────────────
  it("source mapping: every LeadSource value maps to the correct ConversationChannel", async () => {
    await seedStage(T_SRCMAP);

    const cases: Array<{ source: IntakePayload["source"]; expectedChannel: string; phone: string; wh: string }> = [
      { source: "WHATSAPP", expectedChannel: "WHATSAPP", phone: "+910000000001", wh: "wh-srcmap-wa" },
      { source: "WEBSITE", expectedChannel: "WEBSITE", phone: "+910000000002", wh: "wh-srcmap-web" },
      { source: "FB", expectedChannel: "FACEBOOK", phone: "+910000000003", wh: "wh-srcmap-fb" },
      { source: "IG", expectedChannel: "INSTAGRAM", phone: "+910000000004", wh: "wh-srcmap-ig" },
      { source: "MANUAL", expectedChannel: "MANUAL", phone: "+910000000005", wh: "wh-srcmap-manual" },
      { source: "META_LEAD_AD", expectedChannel: "FACEBOOK", phone: "+910000000006", wh: "wh-srcmap-meta" },
      { source: "GOOGLE_FORMS", expectedChannel: "WEBSITE", phone: "+910000000007", wh: "wh-srcmap-gform" },
      { source: "WEBSITE_SNIPPET", expectedChannel: "WEBSITE", phone: "+910000000008", wh: "wh-srcmap-snip" },
      { source: "FORM_BUILDER", expectedChannel: "WEBSITE", phone: "+910000000009", wh: "wh-srcmap-fb-bld" },
      { source: "EMAIL", expectedChannel: "EMAIL", phone: "+910000000010", wh: "wh-srcmap-email" },
      { source: "MESSENGER", expectedChannel: "FACEBOOK", phone: "+910000000011", wh: "wh-srcmap-msgr" },
      { source: "TELEGRAM", expectedChannel: "TELEGRAM", phone: "+910000000012", wh: "wh-srcmap-tg" },
    ];

    for (const c of cases) {
      await seedWebhookLog(T_SRCMAP, c.wh);

      const payload = makePayload(T_SRCMAP, c.wh, {
        source: c.source,
        canonicalFields: {
          phone: c.phone,
          name: `Src Test ${c.source}`,
          notes: `source mapping test for ${c.source}`,
        },
      });

      const out = await dispatch(payload);

      const conv = await prisma.conversation.findFirst({
        where: { tenantId: T_SRCMAP, leadId: out.leadId },
      });
      expect(conv?.channel).toBe(c.expectedChannel);
    }
  });

  // ── Bonus: Webhook log update ────────────────────────────────────────────
  it("webhook log: processed=false before dispatch → processed=true with leadId after dispatch", async () => {
    await seedStage(T_HAPPY);
    await seedWebhookLog(T_HAPPY, "wh-disp-log-check");

    // Verify initial state
    const before = await prisma.intakeWebhookLog.findUnique({ where: { id: "wh-disp-log-check" } });
    expect(before?.processed).toBe(false);
    expect(before?.leadId).toBeNull();

    const payload = makePayload(T_HAPPY, "wh-disp-log-check", {
      canonicalFields: {
        phone: "+910000000001",
        name: "Log Test",
        notes: "log update test",
      },
    });

    const out = await dispatch(payload);

    const after = await prisma.intakeWebhookLog.findUnique({ where: { id: "wh-disp-log-check" } });
    expect(after?.processed).toBe(true);
    expect(after?.leadId).toBe(out.leadId);
  });
});
