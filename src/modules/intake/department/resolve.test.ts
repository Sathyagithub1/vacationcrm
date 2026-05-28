// src/modules/intake/department/resolve.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";

// Mock the AI provider BEFORE importing the module under test.
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue({ departmentId: "__unset__", confidence: 0 }),
  }),
}));

import { resolveDepartment } from "./index";
import { getAIProvider } from "@/modules/ai/provider";
import type { AIProviderWithClassify } from "@/modules/ai/provider";

// ── Fixture helpers ──────────────────────────────────────────────────────────

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function clearTenant(tenantId: string) {
  await prisma.intakeForm.deleteMany({ where: { tenantId } });
  await prisma.department.deleteMany({ where: { tenantId } });
}

async function seedDepartment(opts: {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isActive?: boolean;
}): Promise<string> {
  const dept = await prisma.department.upsert({
    where: { id: opts.id },
    update: {},
    create: {
      id: opts.id,
      tenantId: opts.tenantId,
      name: opts.name,
      slug: opts.id,
      description: opts.description ?? null,
      isActive: opts.isActive ?? true,
    },
  });
  return dept.id;
}

async function seedIntakeForm(opts: {
  id: string;
  tenantId: string;
  departmentId?: string;
}): Promise<string> {
  const form = await prisma.intakeForm.upsert({
    where: { id: opts.id },
    update: {},
    create: {
      id: opts.id,
      tenantId: opts.tenantId,
      source: "WEBSITE",
      externalId: opts.id,
      name: `Form ${opts.id}`,
      fieldMap: {},
      departmentId: opts.departmentId ?? null,
    },
  });
  return form.id;
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
    webhookLogId: "wh-dept-1",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolveDepartment", () => {
  // I1: Reset the AI mock to a safe no-op before every test so that
  // queue-drain bugs and forgotten overrides don't bleed between tests.
  // confidence: 0 (not 0.9) means any test that forgets to set an override
  // gets undefined departmentId rather than a spurious match.
  beforeEach(() => {
    vi.mocked(getAIProvider).mockResolvedValue({
      classify: vi.fn(),
      complete: vi.fn(),
      completeJson: vi.fn().mockResolvedValue({ departmentId: "__unset__", confidence: 0 }),
    } as unknown as AIProviderWithClassify);
  });

  afterAll(async () => {
    await clearTenant("t-dept-1");
    await clearTenant("t-dept-2");
    await clearTenant("t-dept-3");
    await clearTenant("t-dept-4");
    await clearTenant("t-dept-5");
    await clearTenant("t-dept-6");
    await prisma.$disconnect();
  });

  // ── Case 1: Explicit department_id in canonicalFields ──────────────────
  describe("tier 1 — explicit department_id", () => {
    const TENANT = "t-dept-1";
    const DEPT_ID = "dept-explicit-1";

    beforeEach(async () => {
      await ensureTenant(TENANT);
      await clearTenant(TENANT);
      await seedDepartment({ id: DEPT_ID, tenantId: TENANT, name: "Tours" });
    });

    it("uses department_id from canonicalFields when dept exists for tenant", async () => {
      const payload = makePayload(TENANT, {
        canonicalFields: { department_id: DEPT_ID, notes: "I want a tour" },
      });
      const out = await resolveDepartment(payload);
      expect(out.departmentId).toBe(DEPT_ID);
    });
  });

  // ── Case 2: IntakeForm has departmentId ─────────────────────────────────
  describe("tier 2 — IntakeForm fallback", () => {
    const TENANT = "t-dept-2";
    const DEPT_ID = "dept-form-2";
    const FORM_ID = "form-dept-2";

    beforeEach(async () => {
      await ensureTenant(TENANT);
      await clearTenant(TENANT);
      await seedDepartment({ id: DEPT_ID, tenantId: TENANT, name: "Cruises" });
      await seedIntakeForm({ id: FORM_ID, tenantId: TENANT, departmentId: DEPT_ID });
    });

    it("uses IntakeForm departmentId when no explicit id provided", async () => {
      const payload = makePayload(TENANT, {
        intakeFormId: FORM_ID,
        canonicalFields: { notes: "Interested in a cruise" },
      });
      const out = await resolveDepartment(payload);
      expect(out.departmentId).toBe(DEPT_ID);
    });

    // ── C1: Cross-tenant isolation for Tier 2 ─────────────────────────────
    it("does NOT use an IntakeForm that belongs to a different tenant (C1 guard)", async () => {
      // FORM_ID belongs to TENANT ("t-dept-2") with DEPT_ID set.
      // A payload from a different tenant must NOT pick up DEPT_ID.
      const OTHER_TENANT = "t-dept-5";
      await ensureTenant(OTHER_TENANT);
      await clearTenant(OTHER_TENANT);
      // Seed a department for the other tenant so Tier 3 can run (but AI
      // mock returns confidence: 0, so departmentId must stay undefined).
      await seedDepartment({
        id: "dept-other-5",
        tenantId: OTHER_TENANT,
        name: "Other Dept",
      });

      const payload = makePayload(OTHER_TENANT, {
        // intakeFormId belongs to TENANT (t-dept-2), not OTHER_TENANT
        intakeFormId: FORM_ID,
        canonicalFields: { notes: "some notes to trigger tier 3 attempt" },
      });
      const out = await resolveDepartment(payload);
      // Must NOT leak DEPT_ID from tenant t-dept-2
      expect(out.departmentId).toBeUndefined();
    });
  });

  // ── Case 3: AI fallback — high confidence ──────────────────────────────
  describe("tier 3 — AI classification (high confidence)", () => {
    const TENANT = "t-dept-3";
    const DEPT_ID = "d-ai";

    beforeEach(async () => {
      await ensureTenant(TENANT);
      await clearTenant(TENANT);
      await seedDepartment({
        id: DEPT_ID,
        tenantId: TENANT,
        name: "Adventure Tours",
        description: "Trekking, hiking, outdoor adventures",
      });
    });

    it("uses AI result when confidence >= 0.5 and departmentId is known", async () => {
      // Override completeJson for this call only.
      const mockProvider = await getAIProvider(TENANT);
      vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
        departmentId: DEPT_ID,
        confidence: 0.9,
      });

      const payload = makePayload(TENANT, {
        canonicalFields: {
          notes: "Looking for a trekking package in the Himalayas",
        },
      });
      const out = await resolveDepartment(payload);
      expect(out.departmentId).toBe(DEPT_ID);
    });
  });

  // ── Case 4: AI fallback — low confidence → stays undefined ─────────────
  describe("tier 3 — AI classification (low confidence)", () => {
    const TENANT = "t-dept-4";
    const DEPT_ID = "dept-low-conf-4";

    beforeEach(async () => {
      await ensureTenant(TENANT);
      await clearTenant(TENANT);
      await seedDepartment({
        id: DEPT_ID,
        tenantId: TENANT,
        name: "Beach Holidays",
      });
    });

    it("leaves departmentId undefined when AI confidence < 0.5", async () => {
      const mockProvider = await getAIProvider(TENANT);
      vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
        departmentId: DEPT_ID,
        confidence: 0.3,
      });

      const payload = makePayload(TENANT, {
        canonicalFields: { notes: "Not sure what I want" },
      });
      const out = await resolveDepartment(payload);
      expect(out.departmentId).toBeUndefined();
    });
  });

  // ── I2: AI error path — fail-soft on provider throw ────────────────────
  describe("tier 3 — AI provider throws", () => {
    const TENANT = "t-dept-6";
    const DEPT_ID = "dept-ai-throw-6";

    beforeEach(async () => {
      await ensureTenant(TENANT);
      await clearTenant(TENANT);
      // Seed at least one active department so we reach Tier 3.
      await seedDepartment({
        id: DEPT_ID,
        tenantId: TENANT,
        name: "Safari Tours",
      });
    });

    it("leaves departmentId undefined when AI provider throws", async () => {
      const mockProvider = await getAIProvider(TENANT);
      vi.mocked(mockProvider.completeJson).mockRejectedValueOnce(
        new Error("simulated AI failure")
      );

      const payload = makePayload(TENANT, {
        canonicalFields: { notes: "I would like to go on safari" },
      });
      const out = await resolveDepartment(payload);
      // try/catch fail-soft must keep departmentId undefined
      expect(out.departmentId).toBeUndefined();
    });
  });
});
