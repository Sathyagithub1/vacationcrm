/**
 * src/app/api/tenants/route.signup.test.ts
 *
 * Multi-tenant SaaS — Tests for POST /api/tenants (public tenant signup).
 *
 * This file is SEPARATE from route.test.ts because it fully mocks @/lib/prisma
 * (no DB), whereas route.test.ts exercises GET/PUT against a real DB. Keeping
 * them apart avoids the module mock leaking into the DB-backed suite.
 *
 * Mocks: prisma (tenant.findUnique, user.findFirst, $transaction),
 *        provisionTenant, bcryptjs, logAudit. Mirrors the mocking style in
 *        src/app/api/payments/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockTenantFindUnique,
  mockUserFindFirst,
  mockTransaction,
  mockProvisionTenant,
  mockHash,
  mockLogAudit,
} = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockProvisionTenant: vi.fn(),
  mockHash: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mockTenantFindUnique },
    user: { findFirst: mockUserFindFirst },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/tenant-provisioning", () => ({
  provisionTenant: mockProvisionTenant,
  slugify: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
}));

vi.mock("bcryptjs", () => ({
  default: { hash: mockHash },
  hash: mockHash,
}));

vi.mock("@/modules/audit/audit.service", () => ({
  logAudit: mockLogAudit,
}));

// GET/PUT pull these in the same module — provide inert stubs so import resolves.
vi.mock("@/modules/auth/tenant.middleware", () => ({
  requireAuth: vi.fn(),
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));
vi.mock("@/modules/auth/rbac", () => ({ hasPermission: vi.fn() }));
vi.mock("@/modules/white-label/theme.service", () => ({ buildThemeConfig: vi.fn() }));
vi.mock("@/lib/crypto/credential-encryption", () => ({ encryptCredential: vi.fn() }));

import { POST } from "./route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/tenants", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const VALID = {
  companyName: "Acme Travels",
  adminName: "Jane Doe",
  email: "jane@acme.com",
  password: "supersecret",
};

const ORIGINAL_FLAG = process.env.SIGNUP_ENABLED;

describe("POST /api/tenants (signup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHash.mockResolvedValue("hashed-pw");
    mockLogAudit.mockResolvedValue(undefined);
    // Default transaction impl: invoke the callback with a fake tx client.
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({}));
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.SIGNUP_ENABLED;
    else process.env.SIGNUP_ENABLED = ORIGINAL_FLAG;
  });

  it("returns 403 when SIGNUP_ENABLED is not 'true' (default off)", async () => {
    delete process.env.SIGNUP_ENABLED;

    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(403);
    expect(mockProvisionTenant).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates tenant + admin transactionally when enabled", async () => {
    process.env.SIGNUP_ENABLED = "true";
    mockTenantFindUnique.mockResolvedValue(null);
    mockUserFindFirst.mockResolvedValue(null);
    mockProvisionTenant.mockResolvedValue({
      tenantId: "tenant-new-1",
      adminUserId: "user-new-1",
      slug: "acme-travels",
    });

    const res = await POST(makeReq(VALID));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.tenant.id).toBe("tenant-new-1");
    expect(json.tenant.slug).toBe("acme-travels");
    // Password hashed via bcrypt (cost 12) before provisioning.
    expect(mockHash).toHaveBeenCalledWith("supersecret", 12);
    // Provisioning ran inside a transaction with a lowercased email + slug.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockProvisionTenant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyName: "Acme Travels",
        slug: "acme-travels",
        adminName: "Jane Doe",
        adminEmail: "jane@acme.com",
        adminPasswordHash: "hashed-pw",
      }),
    );
  });

  it("returns 409 when the workspace slug already exists", async () => {
    process.env.SIGNUP_ENABLED = "true";
    mockTenantFindUnique.mockResolvedValue({ id: "existing-tenant" });
    mockUserFindFirst.mockResolvedValue(null);

    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(409);
    expect(mockProvisionTenant).not.toHaveBeenCalled();
  });

  it("returns 409 when the admin email already exists", async () => {
    process.env.SIGNUP_ENABLED = "true";
    mockTenantFindUnique.mockResolvedValue(null);
    mockUserFindFirst.mockResolvedValue({ id: "existing-user" });

    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(409);
    expect(mockProvisionTenant).not.toHaveBeenCalled();
  });

  it("returns 409 on a Prisma P2002 unique-constraint race", async () => {
    process.env.SIGNUP_ENABLED = "true";
    mockTenantFindUnique.mockResolvedValue(null);
    mockUserFindFirst.mockResolvedValue(null);
    mockProvisionTenant.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(409);
  });

  it("validates missing/short company name", async () => {
    process.env.SIGNUP_ENABLED = "true";
    const res = await POST(makeReq({ ...VALID, companyName: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("companyName");
  });

  it("validates a bad email", async () => {
    process.env.SIGNUP_ENABLED = "true";
    const res = await POST(makeReq({ ...VALID, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("email");
  });

  it("validates password length < 8", async () => {
    process.env.SIGNUP_ENABLED = "true";
    const res = await POST(makeReq({ ...VALID, password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("8");
  });

  it("lowercases the admin email before provisioning", async () => {
    process.env.SIGNUP_ENABLED = "true";
    mockTenantFindUnique.mockResolvedValue(null);
    mockUserFindFirst.mockResolvedValue(null);
    mockProvisionTenant.mockResolvedValue({
      tenantId: "t2",
      adminUserId: "u2",
      slug: "acme-travels",
    });

    await POST(makeReq({ ...VALID, email: "Jane@ACME.com" }));

    expect(mockProvisionTenant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ adminEmail: "jane@acme.com" }),
    );
  });
});
