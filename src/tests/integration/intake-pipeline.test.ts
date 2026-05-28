// src/tests/integration/intake-pipeline.test.ts

/**
 * End-to-end integration tests for the full 7-stage intake pipeline.
 *
 * One test per LeadSource — each runs through the real pipeline with a real
 * DB and a mocked AI provider. Tests are fully isolated via per-source tenants
 * so there is no cross-test bleed.
 *
 * Phase 6a — T35
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";

// ── AI provider mock ─────────────────────────────────────────────────────────
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn().mockResolvedValue({ isSpam: false, confidence: 0.1 }),
    complete: vi.fn().mockResolvedValue("en"),
    completeJson: vi
      .fn()
      .mockResolvedValue({ departmentId: "__unset__", confidence: 0 }),
  }),
}));

// ── Tenant constants (one per source for full isolation) ─────────────────────
const T_WHATSAPP     = "t-e2e-whatsapp";
const T_WEBSITE      = "t-e2e-website";
const T_META_LEAD_AD = "t-e2e-metaleadad";
const T_GOOGLE_FORMS = "t-e2e-googleforms";
const T_TELEGRAM     = "t-e2e-telegram";
const T_EMAIL        = "t-e2e-email";
const T_MANUAL       = "t-e2e-manual";

const ALL_TENANTS = [
  T_WHATSAPP,
  T_WEBSITE,
  T_META_LEAD_AD,
  T_GOOGLE_FORMS,
  T_TELEGRAM,
  T_EMAIL,
  T_MANUAL,
];

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedTenant(
  tenantId: string,
  source: IntakePayload["source"]
): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: tenantId, slug: tenantId },
  });

  await prisma.department.upsert({
    where: { id: `${tenantId}-dept` },
    update: {},
    create: {
      id: `${tenantId}-dept`,
      tenantId,
      name: "Default",
      slug: "default",
    },
  });

  await prisma.pipelineStage.upsert({
    where: { id: `${tenantId}-stage-new` },
    update: {},
    create: {
      id: `${tenantId}-stage-new`,
      tenantId,
      name: "New",
      slug: "new",
      position: 0,
      isDefault: true,
    },
  });

  await prisma.assignmentStrategy.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, type: "ROUND_ROBIN", config: {} },
  });

  // 2 active agents
  for (let i = 1; i <= 2; i++) {
    await prisma.user.upsert({
      where: { id: `${tenantId}-agent-${i}` },
      update: {},
      create: {
        id: `${tenantId}-agent-${i}`,
        tenantId,
        email: `agent${i}@${tenantId}.test`,
        passwordHash: "x",
        name: `Agent ${i}`,
        role: "AGENT",
        isActive: true,
        departmentId: `${tenantId}-dept`,
      },
    });
  }

  // 1 company admin (fallback target)
  await prisma.user.upsert({
    where: { id: `${tenantId}-admin` },
    update: {},
    create: {
      id: `${tenantId}-admin`,
      tenantId,
      email: `admin@${tenantId}.test`,
      passwordHash: "x",
      name: "Admin",
      role: "COMPANY_ADMIN",
      isActive: true,
    },
  });

  // IntakeForm for the source
  await prisma.intakeForm.upsert({
    where: { id: `${tenantId}-form` },
    update: {},
    create: {
      id: `${tenantId}-form`,
      tenantId,
      source,
      externalId: `${tenantId}-ext`,
      name: `${source} Form`,
      fieldMap: { name: "name", phone: "phone", email: "email" },
      fieldMappingConfirmed: true,
      status: "ACTIVE",
    },
  });
}

async function seedWebhookLog(tenantId: string, id: string, source: IntakePayload["source"]) {
  await prisma.intakeWebhookLog.upsert({
    where: { id },
    update: { processed: false, leadId: null },
    create: {
      id,
      tenantId,
      source,
      endpoint: `/api/intake/${tenantId}`,
      rawPayload: {},
      signatureValid: true,
      processed: false,
    },
  });
}

async function cleanupTenant(tenantId: string) {
  await prisma.leadActivity.deleteMany({ where: { tenantId } });
  await prisma.message.deleteMany({ where: { tenantId } });
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.customer.deleteMany({ where: { tenantId } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId } });
  await prisma.intakeForm.deleteMany({ where: { tenantId } });
  await prisma.assignmentCursor.deleteMany({ where: { tenantId } });
  await prisma.notification.deleteMany({ where: { tenantId } });
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.department.deleteMany({ where: { tenantId } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId } });
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Seed all tenants upfront
  await seedTenant(T_WHATSAPP, "WHATSAPP");
  await seedTenant(T_WEBSITE, "WEBSITE");
  await seedTenant(T_META_LEAD_AD, "META_LEAD_AD");
  await seedTenant(T_GOOGLE_FORMS, "GOOGLE_FORMS");
  await seedTenant(T_TELEGRAM, "TELEGRAM");
  await seedTenant(T_EMAIL, "EMAIL");
  await seedTenant(T_MANUAL, "MANUAL");
});

afterAll(async () => {
  for (const t of ALL_TENANTS) {
    await cleanupTenant(t);
  }
  await prisma.$disconnect();
});

// ── Helper: assert full pipeline output ─────────────────────────────────────

async function assertFullPipelineResult(
  tenantId: string,
  logId: string,
  source: IntakePayload["source"],
  phone: string,
  email: string
) {
  const stages = getDefaultStages();

  await seedWebhookLog(tenantId, logId, source);

  const payload: IntakePayload = {
    tenantId,
    source,
    rawPayload: { name: "Test User", phone, email },
    sender: { phone, email },
    canonicalFields: { name: "Test User", phone, email, notes: `${source} test lead` },
    webhookLogId: logId,
    intakeFormId: `${tenantId}-form`,
  };

  // Must resolve without throwing
  const result = await runPipeline(payload, stages);
  expect(result).toBeDefined();

  // leadId must be set (dispatch ran and created a lead)
  expect(result.leadId).toBeTruthy();

  // Customer created (or matched)
  const customer = await prisma.customer.findFirst({
    where: { tenantId, mobile: phone },
  });
  expect(customer).not.toBeNull();

  // Lead exists with assignedTo set
  const lead = await prisma.lead.findUnique({ where: { id: result.leadId! } });
  expect(lead).not.toBeNull();
  expect(lead!.source).toBe(source);
  expect(lead!.assignedTo).not.toBeNull();

  // Conversation exists
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, leadId: result.leadId },
  });
  expect(conversation).not.toBeNull();

  // At least one customer message
  const customerMessage = await prisma.message.findFirst({
    where: {
      tenantId,
      conversationId: conversation!.id,
      senderType: "CUSTOMER",
    },
  });
  expect(customerMessage).not.toBeNull();

  // ASSIGNMENT activity exists
  const assignmentActivity = await prisma.leadActivity.findFirst({
    where: { tenantId, leadId: result.leadId, type: "ASSIGNMENT" },
  });
  expect(assignmentActivity).not.toBeNull();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("intake pipeline e2e — per source", () => {
  it(
    "WHATSAPP: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_WHATSAPP,
        "wh-e2e-whatsapp",
        "WHATSAPP",
        "+919999001001",
        "test.whatsapp@e2e.test"
      );
    }
  );

  it(
    "WEBSITE: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_WEBSITE,
        "wh-e2e-website",
        "WEBSITE",
        "+919999001002",
        "test.website@e2e.test"
      );
    }
  );

  it(
    "META_LEAD_AD: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_META_LEAD_AD,
        "wh-e2e-metaleadad",
        "META_LEAD_AD",
        "+919999001003",
        "test.metaleadad@e2e.test"
      );
    }
  );

  it(
    "GOOGLE_FORMS: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_GOOGLE_FORMS,
        "wh-e2e-googleforms",
        "GOOGLE_FORMS",
        "+919999001004",
        "test.googleforms@e2e.test"
      );
    }
  );

  it(
    "TELEGRAM: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_TELEGRAM,
        "wh-e2e-telegram",
        "TELEGRAM",
        "+919999001005",
        "test.telegram@e2e.test"
      );
    }
  );

  it(
    "EMAIL: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_EMAIL,
        "wh-e2e-email",
        "EMAIL",
        "+919999001006",
        "test.email@e2e.test"
      );
    }
  );

  it(
    "MANUAL: full pipeline resolves, creates Customer/Lead/Conversation/Message, assignment runs",
    { timeout: 30000 },
    async () => {
      await assertFullPipelineResult(
        T_MANUAL,
        "wh-e2e-manual",
        "MANUAL",
        "+919999001007",
        "test.manual@e2e.test"
      );
    }
  );
});
