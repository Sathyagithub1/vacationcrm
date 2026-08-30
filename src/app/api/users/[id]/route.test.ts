/**
 * Tests for PUT /api/users/[id] — skill-based routing fields (Phase 6p).
 * requirePermission + db + audit are mocked; no DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRequirePermission, mockUserFindFirst, mockUserUpdate, mockLogAudit } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requirePermission: mockRequirePermission,
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));
vi.mock("@/modules/audit/audit.service", () => ({ logAudit: mockLogAudit }));

import { PUT } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/users/u1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const ctx = { params: Promise.resolve({ id: "u1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    user: { id: "admin1", tenantId: "t1", role: "COMPANY_ADMIN" },
    db: { user: { findFirst: mockUserFindFirst, update: mockUserUpdate } },
  });
  mockUserFindFirst.mockResolvedValue({ id: "u1", role: "AGENT", departmentId: null });
  mockUserUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "u1", passwordHash: "x", ...data }),
  );
});

describe("PUT /api/users/[id] skill fields", () => {
  it("persists deduped/trimmed tags and languages", async () => {
    await PUT(req({ tags: [" luxury ", "vip", "vip", ""], languages: ["en", "hi", "hi"] }), ctx);
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data.tags).toEqual(["luxury", "vip"]);
    expect(data.languages).toEqual(["en", "hi"]);
  });

  it("accepts a positive assignmentTier and null to clear", async () => {
    await PUT(req({ assignmentTier: 2 }), ctx);
    expect(mockUserUpdate.mock.calls[0][0].data.assignmentTier).toBe(2);

    mockUserUpdate.mockClear();
    await PUT(req({ assignmentTier: null }), ctx);
    expect(mockUserUpdate.mock.calls[0][0].data.assignmentTier).toBeNull();
  });

  it("rejects an invalid assignmentTier with 400", async () => {
    const res = await PUT(req({ assignmentTier: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("does not touch tags/languages when omitted", async () => {
    await PUT(req({ name: "New Name" }), ctx);
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("tags");
    expect(data).not.toHaveProperty("languages");
    expect(data.name).toBe("New Name");
  });
});
