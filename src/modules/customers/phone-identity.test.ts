/**
 * src/modules/customers/phone-identity.test.ts
 *
 * Unit tests for the phone-as-identity dedupe helper + the POST /api/customers
 * dedupe wiring.
 *
 * Real DB is NOT used — the Prisma client is mocked (hoisted), matching the
 * mocking style in src/app/api/payments/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { normalizePhone, resolveCustomerByPhone } from "./phone-identity";

// ── normalizePhone ────────────────────────────────────────────────────────────

describe("normalizePhone", () => {
  it("returns empty string for non-string / empty input", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone(1234567890 as unknown)).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
    expect(normalizePhone("abc")).toBe("");
  });

  it("strips spaces, dashes, parens and dots", () => {
    expect(normalizePhone("98765 43210")).toBe("9876543210");
    expect(normalizePhone("987-654-3210")).toBe("9876543210");
    expect(normalizePhone("(987) 654-3210")).toBe("9876543210");
    expect(normalizePhone("987.654.3210")).toBe("9876543210");
  });

  it("collapses country-code / trunk-prefix variants to the same last-10 digits", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("919876543210")).toBe("9876543210");
    expect(normalizePhone("098765 43210")).toBe("9876543210"); // leading trunk 0 dropped
    expect(normalizePhone("+1 (415) 555-0132")).toBe("4155550132");
  });

  it("is deterministic — same input always yields the same output", () => {
    const a = normalizePhone("+91-98765-43210");
    const b = normalizePhone("+91-98765-43210");
    expect(a).toBe(b);
    expect(a).toBe("9876543210");
  });

  it("keeps short numbers (<=10 digits) as-is", () => {
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("100")).toBe("100");
  });

  it("treats all these formatting variants of one number as equal", () => {
    const canonical = normalizePhone("9876543210");
    for (const variant of [
      "+91 98765 43210",
      "+91-98765-43210",
      "0 98765 43210",
      "(987) 654 3210",
      "919876543210",
    ]) {
      expect(normalizePhone(variant)).toBe(canonical);
    }
  });
});

// ── resolveCustomerByPhone ─────────────────────────────────────────────────────

describe("resolveCustomerByPhone", () => {
  function makeDb(rows: Array<Record<string, unknown>>) {
    const findMany = vi.fn().mockResolvedValue(rows);
    return { db: { customer: { findMany } }, findMany };
  }

  it("returns null for an unusable phone (no query issued)", async () => {
    const { db, findMany } = makeDb([]);
    const res = await resolveCustomerByPhone(db, "tenant-1", "");
    expect(res).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the existing customer on a normalized match (formatting differs)", async () => {
    const existing = { id: "cust-1", name: "Alice", mobile: "+91 98765 43210" };
    const { db } = makeDb([existing]);

    // Input uses a different format for the SAME subscriber number.
    const res = await resolveCustomerByPhone(db, "tenant-1", "9876543210");
    expect(res).toEqual(existing);
  });

  it("matches against alternatePhone as well", async () => {
    const existing = { id: "cust-2", name: "Bob", mobile: "1112223333", alternatePhone: "+91 98765 43210" };
    const { db } = makeDb([existing]);

    const res = await resolveCustomerByPhone(db, "tenant-1", "0 98765 43210");
    expect(res).toEqual(existing);
  });

  it("returns null when no candidate normalizes to the same number", async () => {
    // SQL suffix-narrowing might surface a near-miss; JS equality must reject it.
    const nearMiss = { id: "cust-3", mobile: "9876540000" };
    const { db } = makeDb([nearMiss]);

    const res = await resolveCustomerByPhone(db, "tenant-1", "9876543210");
    expect(res).toBeNull();
  });

  it("scopes the query to the given tenantId", async () => {
    const { db, findMany } = makeDb([]);
    await resolveCustomerByPhone(db, "tenant-XYZ", "9876543210");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-XYZ" }),
      })
    );
  });
});

// ── POST /api/customers dedupe wiring ──────────────────────────────────────────

const { mockRequireAuth, mockRequirePermission } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRequirePermission: vi.fn(),
}));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requireAuth: mockRequireAuth,
  requirePermission: mockRequirePermission,
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));

const { mockLogAudit } = vi.hoisted(() => ({ mockLogAudit: vi.fn() }));
vi.mock("@/modules/audit/audit.service", () => ({ logAudit: mockLogAudit }));

const { mockCustomerFindMany, mockCustomerCreate, mockCustomerFindFirst, mockCustomerCount } = vi.hoisted(() => ({
  mockCustomerFindMany: vi.fn(),
  mockCustomerCreate: vi.fn(),
  mockCustomerFindFirst: vi.fn(),
  mockCustomerCount: vi.fn(),
}));

function makeSession(tenantId = "tenant-1") {
  const db = {
    customer: {
      findMany: mockCustomerFindMany,
      create: mockCustomerCreate,
      findFirst: mockCustomerFindFirst,
      count: mockCustomerCount,
    },
  };
  mockRequirePermission.mockResolvedValue({ user: { id: "user-1", tenantId, role: "COMPANY_ADMIN" }, db });
  mockRequireAuth.mockResolvedValue({ user: { id: "user-1", tenantId, role: "COMPANY_ADMIN" }, db });
  return db;
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/customers", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/customers — phone dedupe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("REUSES an existing customer on a duplicate (normalized) phone — no create", async () => {
    makeSession();
    const existing = { id: "cust-existing", name: "Alice", mobile: "+91 98765 43210" };
    mockCustomerFindMany.mockResolvedValue([existing]);

    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeReq({ name: "Alice (dup)", mobile: "9876543210" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deduped).toBe(true);
    expect(json.customer).toEqual(existing);
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("CREATES a new customer when the phone is new", async () => {
    makeSession();
    mockCustomerFindMany.mockResolvedValue([]); // no existing match
    const created = { id: "cust-new", name: "Carol", mobile: "9000000000" };
    mockCustomerCreate.mockResolvedValue(created);

    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeReq({ name: "Carol", mobile: "9000000000" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.customer).toEqual(created);
    expect(json.deduped).toBeUndefined();
    expect(mockCustomerCreate).toHaveBeenCalledOnce();
  });

  it("returns 400 when name is missing (validation preserved)", async () => {
    makeSession();
    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeReq({ mobile: "9000000000" }));
    expect(res.status).toBe(400);
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when mobile is missing (validation preserved)", async () => {
    makeSession();
    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeReq({ name: "NoPhone" }));
    expect(res.status).toBe(400);
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });
});
