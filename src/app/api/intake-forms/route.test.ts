/**
 * src/app/api/intake-forms/route.test.ts
 *
 * T35 tests — IntakeForm CRUD + field-map + test replay.
 * Uses real DB. Auth is stubbed via next-auth getServerSession mock.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// ── Stub next-auth ────────────────────────────────────────────────────────────
// Decision: stub getServerSession rather than wiring real JWT for API-level
// tests. Production auth is wired in next-auth middleware; these tests cover
// the route logic + DB interaction.
const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => mockSession.value),
}));

import { GET as listForms, POST as createForm } from "./route";
import { GET as getForm, PATCH as patchForm } from "./[id]/route";
import { PATCH as patchFieldMap } from "./[id]/field-map/route";

// ── Constants ─────────────────────────────────────────────────────────────────
const T_ADMIN  = "t-iform-admin";
const T_AGENT  = "t-iform-agent";
const T_OTHER  = "t-iform-other"; // Tenant isolation

// ── Helpers ───────────────────────────────────────────────────────────────────

function setSession(tenantId: string, role: string, departmentId?: string) {
  mockSession.value = {
    user: { id: `user-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId, departmentId },
  };
}

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({ where: { id }, update: {}, create: { id, name: id, slug: id } });
}

async function seedAdmin(tenantId: string) {
  await prisma.user.upsert({
    where: { id: `user-${tenantId}` },
    update: {},
    create: {
      id: `user-${tenantId}`, tenantId,
      email: `u@${tenantId}.com`, passwordHash: "x",
      name: "Admin", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [],
    },
  });
}

async function clearTenant(tenantId: string) {
  await prisma.intakeForm.deleteMany({ where: { tenantId } });
  await prisma.intakeWebhookLog.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
}

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  for (const t of [T_ADMIN, T_AGENT, T_OTHER]) {
    await ensureTenant(t);
    await clearTenant(t);
  }
  await seedAdmin(T_ADMIN);
  await seedAdmin(T_OTHER);
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_AGENT, T_OTHER]) await clearTenant(t);
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("T35 IntakeForm CRUD + field-map", () => {

  // ── Happy path: list + create ─────────────────────────────────────────────

  it("POST /api/intake-forms: admin can create a form → 201 with form object", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    const res = await createForm(makeReq("/api/intake-forms", "POST", {
      source: "WEBSITE",
      externalId: "form-ext-001",
      name: "Contact Form",
      fieldMap: { name: "customerName" },
    }));

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect((json.form as Record<string, unknown>).id).toBeTruthy();
    expect((json.form as Record<string, unknown>).status).toBe("PENDING_REVIEW");
  });

  it("GET /api/intake-forms: admin can list forms with pagination", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Create 2 forms first
    await createForm(makeReq("/api/intake-forms", "POST", { source: "WEBSITE", externalId: "f1", name: "F1", fieldMap: {} }));
    await createForm(makeReq("/api/intake-forms", "POST", { source: "FB",      externalId: "f2", name: "F2", fieldMap: {} }));

    const res = await listForms(makeReq("/api/intake-forms?limit=10"));
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect((json.forms as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(json.total).toBeGreaterThanOrEqual(2);
  });

  // ── RBAC: AGENT is denied ─────────────────────────────────────────────────

  it("POST /api/intake-forms: AGENT role → 403", async () => {
    setSession(T_AGENT, "AGENT");

    const res = await createForm(makeReq("/api/intake-forms", "POST", {
      source: "WEBSITE",
      externalId: "agent-form",
      name: "Agent Form",
      fieldMap: {},
    }));

    expect(res.status).toBe(403);
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────

  it("GET /api/intake-forms/[id]: tenant B cannot read tenant A form → 404", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    // Create form as tenant A
    const createRes = await createForm(makeReq("/api/intake-forms", "POST", {
      source: "WEBSITE", externalId: "isolation-form", name: "Isolation", fieldMap: {},
    }));
    const { form } = await createRes.json() as { form: { id: string } };

    // Switch to tenant B, try to fetch tenant A's form
    setSession(T_OTHER, "COMPANY_ADMIN");

    const res = await getForm(makeReq(`/api/intake-forms/${form.id}`), makeCtx(form.id));
    // tenantPrisma scopes findFirst to T_OTHER's tenantId → form not found
    expect(res.status).toBe(404);
  });

  // ── Field-map confirm ─────────────────────────────────────────────────────

  it("PATCH /api/intake-forms/[id]/field-map: confirms map, sets status=ACTIVE, fieldMappingConfirmed=true", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    const createRes = await createForm(makeReq("/api/intake-forms", "POST", {
      source: "GOOGLE_FORMS", externalId: "gform-fm", name: "GForm", fieldMap: {},
    }));
    const { form } = await createRes.json() as { form: { id: string } };

    const patchRes = await patchFieldMap(
      makeReq(`/api/intake-forms/${form.id}/field-map`, "PATCH", {
        fieldMap: { fullName: "name", phone_number: "phone" },
      }),
      makeCtx(form.id),
    );

    expect(patchRes.status).toBe(200);
    const json = await patchRes.json() as Record<string, unknown>;
    const updated = json.form as Record<string, unknown>;
    expect(updated.fieldMappingConfirmed).toBe(true);
    expect(updated.status).toBe("ACTIVE");
  });

  // ── Rename / pause ────────────────────────────────────────────────────────

  it("PATCH /api/intake-forms/[id]: can rename and pause a form", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");

    const createRes = await createForm(makeReq("/api/intake-forms", "POST", {
      source: "EMAIL", externalId: "email-form", name: "Email Form", fieldMap: {},
    }));
    const { form } = await createRes.json() as { form: { id: string } };

    const patchRes = await patchForm(
      makeReq(`/api/intake-forms/${form.id}`, "PATCH", { name: "Email Renamed", status: "PAUSED" }),
      makeCtx(form.id),
    );

    expect(patchRes.status).toBe(200);
    const json = await patchRes.json() as Record<string, unknown>;
    const updated = json.form as Record<string, unknown>;
    expect(updated.name).toBe("Email Renamed");
    expect(updated.status).toBe("PAUSED");
  });
});
