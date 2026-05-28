// src/tests/load/intake-burst-dedup.test.ts

/**
 * Load test: dedup correctness under concurrency.
 *
 * 100 concurrent intakes from 50 unique senders (each phone submits twice).
 * Asserts exactly 50 Customers, 50 Leads, 50 REPEAT_INQUIRY activities.
 *
 * Prisma's default connection pool is ~10. Running 100 truly concurrent
 * operations risks connection exhaustion. We batch into chunks of 25
 * (documented in TODO_BLOCKERS.md) to stay within pool limits while still
 * exercising dedup under meaningful concurrency.
 *
 * Phase 6a — T36
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

const TENANT = "t-load-dedup";

async function seedTenant() {
  await prisma.tenant.upsert({
    where: { id: TENANT },
    update: {},
    create: { id: TENANT, name: TENANT, slug: TENANT },
  });
  await prisma.pipelineStage.upsert({
    where: { id: `${TENANT}-stage-new` },
    update: {},
    create: {
      id: `${TENANT}-stage-new`,
      tenantId: TENANT,
      name: "New",
      slug: "new",
      position: 0,
      isDefault: true,
    },
  });
  await prisma.user.upsert({
    where: { id: `${TENANT}-agent-1` },
    update: {},
    create: {
      id: `${TENANT}-agent-1`,
      tenantId: TENANT,
      email: "agent1@load.test",
      passwordHash: "x",
      name: "Agent 1",
      role: "AGENT",
      isActive: true,
    },
  });
  await prisma.user.upsert({
    where: { id: `${TENANT}-admin-1` },
    update: {},
    create: {
      id: `${TENANT}-admin-1`,
      tenantId: TENANT,
      email: "admin@load.test",
      passwordHash: "x",
      name: "Admin",
      role: "COMPANY_ADMIN",
      isActive: true,
    },
  });
  await prisma.assignmentStrategy.upsert({
    where: { tenantId: TENANT },
    update: {},
    create: { tenantId: TENANT, type: "ROUND_ROBIN", config: {} },
  });
}

async function cleanup() {
  await prisma.leadActivity.deleteMany({ where: { tenantId: TENANT } });
  await prisma.message.deleteMany({ where: { tenantId: TENANT } });
  await prisma.conversation.deleteMany({ where: { tenantId: TENANT } });
  await prisma.lead.deleteMany({ where: { tenantId: TENANT } });
  await prisma.customer.deleteMany({ where: { tenantId: TENANT } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId: TENANT } });
  await prisma.assignmentCursor.deleteMany({ where: { tenantId: TENANT } });
  await prisma.notification.deleteMany({ where: { tenantId: TENANT } });
}

/** Run payloads in serial batches of `batchSize` to avoid connection pool exhaustion. */
async function runInBatches(
  payloads: IntakePayload[],
  batchSize: number
): Promise<void> {
  const stages = getDefaultStages();
  for (let i = 0; i < payloads.length; i += batchSize) {
    const batch = payloads.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((p) => runPipeline(p, stages)));
  }
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await seedTenant();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ── Test ─────────────────────────────────────────────────────────────────────

describe("intake-burst-dedup", () => {
  it(
    "100 intakes from 50 senders → exactly 50 Customers, 50 Leads, 50 REPEAT_INQUIRY",
    { timeout: 120000 },
    async () => {
      const phones = Array.from({ length: 50 }, (_, i) =>
        `+91900000${String(i).padStart(4, "0")}`
      );

      // Build 100 payloads: each phone twice
      const payloads: IntakePayload[] = [];
      for (const phone of phones) {
        for (let j = 0; j < 2; j++) {
          const log = await prisma.intakeWebhookLog.create({
            data: {
              tenantId: TENANT,
              source: "WHATSAPP",
              endpoint: "/test",
              rawPayload: { phone, name: `User ${phone}` },
              signatureValid: true,
            },
          });
          payloads.push({
            tenantId: TENANT,
            source: "WHATSAPP",
            rawPayload: { phone, name: `User ${phone}` },
            sender: { phone },
            canonicalFields: { phone, name: `User ${phone}`, notes: `load test ${phone}` },
            webhookLogId: log.id,
          });
        }
      }

      // Run all 100 in batches of 25 to avoid connection pool exhaustion.
      // See TODO_BLOCKERS.md for details on the pool limit.
      await runInBatches(payloads, 25);

      const customers = await prisma.customer.count({ where: { tenantId: TENANT } });
      const leads = await prisma.lead.count({ where: { tenantId: TENANT } });
      const repeats = await prisma.leadActivity.count({
        where: { tenantId: TENANT, type: "REPEAT_INQUIRY" },
      });

      // Customer table has @@unique([tenantId, mobile]) — the DB enforces
      // exactly 50 unique customers no matter how many concurrent intakes hit.
      expect(customers).toBe(50);

      // Phase 6e B7 fix: per-phone advisory lock in dedupCheck serialises
      // concurrent intakes for the same phone.  The second intake now waits for
      // the first to commit, finds the existing Lead, and creates REPEAT_INQUIRY
      // instead of a duplicate Lead.  Strict invariants now apply.
      expect(leads).toBe(50);
      expect(repeats).toBe(50);

      // Log actual numbers so the load profile is visible in CI output
      // eslint-disable-next-line no-console
      console.log(
        `dedup load result: customers=${customers}, leads=${leads}, repeats=${repeats}`
      );
    }
  );
});
