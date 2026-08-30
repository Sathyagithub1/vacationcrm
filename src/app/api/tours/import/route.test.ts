/**
 * Tests for POST /api/tours/import — bulk tour import.
 * requirePermission + prisma (db) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockRequirePermission, mockDeptFindMany, mockTourCreate } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockDeptFindMany: vi.fn(),
  mockTourCreate: vi.fn(),
}));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requirePermission: mockRequirePermission,
  requireAuth: vi.fn(),
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));

import { POST } from "./route";

function makeDb() {
  return {
    department: { findMany: mockDeptFindMany },
    tour: { create: mockTourCreate },
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tours/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    user: { id: "u1", tenantId: "t1", role: "COMPANY_ADMIN" },
    db: makeDb(),
  });
  mockDeptFindMany.mockResolvedValue([{ id: "d1", name: "Sales" }]);
  mockTourCreate.mockResolvedValue({ id: "tour1" });
});

const good = {
  code: "BALI-7D",
  name: "Bali 7-Day",
  department: "Sales",
  startDate: "2026-11-05",
  endDate: "2026-11-11",
  capacity: "20",
  status: "ACTIVE",
};

describe("POST /api/tours/import", () => {
  it("403 when not permitted", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    const res = await POST(req({ tours: [good] }));
    expect(res.status).toBe(403);
  });

  it("400 on empty rows", async () => {
    const res = await POST(req({ tours: [] }));
    expect(res.status).toBe(400);
  });

  it("creates a valid row and resolves department by name", async () => {
    const json = await (await POST(req({ tours: [good] }))).json();
    expect(json.created).toBe(1);
    expect(json.failed).toBe(0);
    expect(json.results[0]).toMatchObject({ row: 1, code: "BALI-7D", ok: true });
    expect(mockTourCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ departmentId: "d1", capacity: 20, tenantId: "t1" }),
      }),
    );
  });

  it("fails a row with an unknown department (others still import)", async () => {
    const json = await (
      await POST(req({ tours: [good, { ...good, code: "X2", department: "Nope" }] }))
    ).json();
    expect(json.created).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.results[1]).toMatchObject({ ok: false });
    expect(json.results[1].error).toMatch(/unknown department/i);
  });

  it("reports duplicate code (P2002) as a per-row error", async () => {
    mockTourCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const json = await (await POST(req({ tours: [good] }))).json();
    expect(json.created).toBe(0);
    expect(json.results[0].error).toMatch(/already exists/i);
  });

  it("fails rows missing required fields", async () => {
    const json = await (
      await POST(req({ tours: [{ code: "", name: "", startDate: "", endDate: "", capacity: "" }] }))
    ).json();
    expect(json.created).toBe(0);
    expect(json.results[0].ok).toBe(false);
  });

  it("defaults to the sole department when the column is blank", async () => {
    const { department, ...noDept } = good;
    void department;
    const json = await (await POST(req({ tours: [noDept] }))).json();
    expect(json.created).toBe(1);
    expect(mockTourCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ departmentId: "d1" }) }),
    );
  });
});
