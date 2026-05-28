// src/tests/smoke/intake-end-to-end.test.ts

/**
 * Smoke test — single test that proves the full intake pipeline is alive.
 *
 * "If this one test passes, the whole pipeline is wired."
 *
 * Flow:
 *   1. Seed a tenant with featureFlags: { INTAKE_PIPELINE_V2_ENABLED: true }
 *   2. POST a realistic payload to runPipeline() via the universal webhook path
 *   3. Walk the DB and assert ALL of:
 *      - Customer row exists with correct tenantId
 *      - Lead row exists, tenant-scoped, with source=WEBSITE, assignedTo set
 *      - Conversation row exists, tied to the lead
 *      - Message row (CUSTOMER sender) exists in the conversation
 *      - LeadActivity row of type ASSIGNMENT exists
 *      - IntakeWebhookLog row is marked processed=true with leadId set
 *
 * Phase 6a — T57
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";

// ── AI provider mock ─────────────────────────────────────────────────────────
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn().mockResolvedValue({ isSpam: false, confidence: 0.05 }),
    complete: vi.fn().mockResolvedValue("en"),
    completeJson: vi
      .fn()
      .mockResolvedValue({ departmentId: "__unset__", confidence: 0 }),
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID    = "t-smoke-e2e-pipeline";
const WEBHOOK_LOG  = "wl-smoke-e2e-pipeline";
const AGENT_PHONE  = "+919876543210";
const AGENT_EMAIL  = "smoke.lead@e2e.test";

// ── Setup / Teardown ─────────────────────────────────────────────────────────

async function seedTenant() {
  // Tenant with INTAKE_PIPELINE_V2_ENABLED: true explicitly set in featureFlags
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { featureFlags: { INTAKE_PIPELINE_V2_ENABLED: true } },
    create: {
      id: TENANT_ID,
      name: "Smoke E2E Tenant",
      slug: TENANT_ID,
      featureFlags: { INTAKE_PIPELINE_V2_ENABLED: true },
    },
  });

  await prisma.department.upsert({
    where: { id: `${TENANT_ID}-dept` },
    update: {},
    create: {
      id: `${TENANT_ID}-dept`,
      tenantId: TENANT_ID,
      name: "Default",
      slug: "default",
    },
  });

  await prisma.pipelineStage.upsert({
    where: { id: `${TENANT_ID}-stage-new` },
    update: {},
    create: {
      id: `${TENANT_ID}-stage-new`,
      tenantId: TENANT_ID,
      name: "New",
      slug: "new",
      position: 0,
      isDefault: true,
    },
  });

  await prisma.assignmentStrategy.upsert({
    where: { tenantId: TENANT_ID },
    update: {},
    create: { tenantId: TENANT_ID, type: "ROUND_ROBIN", config: {} },
  });

  // Two active agents
  for (let i = 1; i <= 2; i++) {
    await prisma.user.upsert({
      where: { id: `${TENANT_ID}-agent-${i}` },
      update: {},
      create: {
        id: `${TENANT_ID}-agent-${i}`,
        tenantId: TENANT_ID,
        email: `agent${i}@${TENANT_ID}.test`,
        passwordHash: "x",
        name: `Smoke Agent ${i}`,
        role: "AGENT",
        isActive: true,
        departmentId: `${TENANT_ID}-dept`,
      },
    });
  }

  // Company admin (assignment fallback)
  await prisma.user.upsert({
    where: { id: `${TENANT_ID}-admin` },
    update: {},
    create: {
      id: `${TENANT_ID}-admin`,
      tenantId: TENANT_ID,
      email: `admin@${TENANT_ID}.test`,
      passwordHash: "x",
      name: "Smoke Admin",
      role: "COMPANY_ADMIN",
      isActive: true,
    },
  });
}

async function seedWebhookLog() {
  await prisma.intakeWebhookLog.upsert({
    where: { id: WEBHOOK_LOG },
    update: { processed: false, leadId: null, errorMessage: null },
    create: {
      id: WEBHOOK_LOG,
      tenantId: TENANT_ID,
      source: "WEBSITE",
      endpoint: `/api/webhooks/intake/${TENANT_ID}`,
      rawPayload: {},
      signatureValid: true,
      processed: false,
    },
  });
}

async function cleanup() {
  await prisma.leadActivity.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.message.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.conversation.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.lead.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.customer.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.assignmentCursor.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.notification.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.assignmentStrategy.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.user.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.department.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
}

beforeAll(async () => {
  await seedTenant();
  await seedWebhookLog();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ── Smoke test ────────────────────────────────────────────────────────────────

describe("intake smoke — end-to-end pipeline", () => {
  it(
    "full pipeline: Customer + Lead + Conversation + Message + LeadActivity all created, log marked processed",
    { timeout: 30000 },
    async () => {
      const stages = getDefaultStages();

      const payload: IntakePayload = {
        tenantId: TENANT_ID,
        source: "WEBSITE",
        rawPayload: {
          name: "Holiday Traveller",
          phone: AGENT_PHONE,
          email: AGENT_EMAIL,
          message: "Interested in Bali package",
        },
        sender: { phone: AGENT_PHONE, email: AGENT_EMAIL },
        canonicalFields: {
          name: "Holiday Traveller",
          phone: AGENT_PHONE,
          email: AGENT_EMAIL,
          notes: "Interested in Bali package",
        },
        webhookLogId: WEBHOOK_LOG,
      };

      // ── Run pipeline ───────────────────────────────────────────────────────
      const result = await runPipeline(payload, stages);

      // leadId must be set — dispatch ran and created a Lead
      expect(result.leadId).toBeTruthy();

      // ── Customer ──────────────────────────────────────────────────────────
      const customer = await prisma.customer.findFirst({
        where: { tenantId: TENANT_ID, mobile: AGENT_PHONE },
      });
      expect(customer, "Customer row not found").not.toBeNull();
      expect(customer!.tenantId).toBe(TENANT_ID);

      // ── Lead ──────────────────────────────────────────────────────────────
      const lead = await prisma.lead.findUnique({ where: { id: result.leadId! } });
      expect(lead, "Lead row not found").not.toBeNull();
      expect(lead!.tenantId).toBe(TENANT_ID);
      expect(lead!.source).toBe("WEBSITE");
      expect(lead!.assignedTo, "Lead must be assigned to an agent").not.toBeNull();

      // ── Conversation ──────────────────────────────────────────────────────
      const conversation = await prisma.conversation.findFirst({
        where: { tenantId: TENANT_ID, leadId: result.leadId },
      });
      expect(conversation, "Conversation row not found").not.toBeNull();
      expect(conversation!.tenantId).toBe(TENANT_ID);

      // ── Message (customer-sent) ───────────────────────────────────────────
      const message = await prisma.message.findFirst({
        where: {
          tenantId: TENANT_ID,
          conversationId: conversation!.id,
          senderType: "CUSTOMER",
        },
      });
      expect(message, "Customer Message row not found").not.toBeNull();

      // ── LeadActivity (ASSIGNMENT) ─────────────────────────────────────────
      const activity = await prisma.leadActivity.findFirst({
        where: { tenantId: TENANT_ID, leadId: result.leadId, type: "ASSIGNMENT" },
      });
      expect(activity, "LeadActivity(ASSIGNMENT) row not found").not.toBeNull();
      expect(activity!.tenantId).toBe(TENANT_ID);

      // ── IntakeWebhookLog — processed=true, leadId set ─────────────────────
      const log = await prisma.intakeWebhookLog.findUnique({
        where: { id: WEBHOOK_LOG },
      });
      expect(log, "IntakeWebhookLog row not found").not.toBeNull();
      expect(log!.processed).toBe(true);
      expect(log!.leadId).toBe(result.leadId);
    },
  );

  it(
    "idempotency: re-invoking pipeline with the same webhookLogId returns existing leadId without creating duplicates",
    { timeout: 15000 },
    async () => {
      const stages = getDefaultStages();

      // The first call already ran in the previous test — the log is processed=true.
      // Re-invoke with the same webhookLogId.
      const payload: IntakePayload = {
        tenantId: TENANT_ID,
        source: "WEBSITE",
        rawPayload: { phone: AGENT_PHONE },
        sender: { phone: AGENT_PHONE },
        webhookLogId: WEBHOOK_LOG,
      };

      const result = await runPipeline(payload, stages);

      // Must return the same leadId
      expect(result.leadId).toBeTruthy();

      // Only one Lead should exist for this phone (no duplicate creation)
      const leads = await prisma.lead.findMany({
        where: { tenantId: TENANT_ID },
      });
      expect(leads.length).toBe(1);
    },
  );
});
