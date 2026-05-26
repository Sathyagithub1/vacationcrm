// src/modules/intake/department/resolve.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";

// Mock the AI provider BEFORE importing the module under test.
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockImplementation(async (_prompt: string) => {
      // Default: high-confidence response — individual tests override this
      // via mockResolvedValueOnce.
      return { departmentId: "__unset__", confidence: 0.9 };
    }),
  }),
}));

import { resolveDepartment } from "./index";
import { getAIProvider } from "@/modules/ai/provider";

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
  afterAll(async () => {
    await clearTenant("t-dept-1");
    await clearTenant("t-dept-2");
    await clearTenant("t-dept-3");
    await clearTenant("t-dept-4");
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
});
