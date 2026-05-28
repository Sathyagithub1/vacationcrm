/**
 * src/app/api/voice-calls/route.test.ts
 *
 * Tests for the voice call list and detail API (Phase 6d).
 *
 * Tests cover:
 *   - GET /api/voice-calls returns paginated list
 *   - GET /api/voice-calls?status=COMPLETED filters by status
 *   - GET /api/voice-calls/[id] returns call with segments
 *   - GET /api/voice-calls/[id] returns 404 for unknown call
 *   - Unauthenticated requests → 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoist mocks ───────────────────────────────────────────────────────────────
const {
  mockRequireAuth,
  mockVoiceCallFindMany,
  mockVoiceCallCount,
  mockVoiceCallFindUnique,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockVoiceCallFindMany: vi.fn(),
  mockVoiceCallCount: vi.fn(),
  mockVoiceCallFindUnique: vi.fn(),
}));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requireAuth: mockRequireAuth,
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  requirePermission: mockRequireAuth,
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));

const mockDb = {
  voiceCall: {
    findMany: mockVoiceCallFindMany,
    count: mockVoiceCallCount,
    findUnique: mockVoiceCallFindUnique,
  },
};

import { GET as listGET } from "./route";
import { GET as detailGET } from "./[id]/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setAuth() {
  mockRequireAuth.mockResolvedValue({ user: { tenantId: "tenant-1", role: "AGENT" }, db: mockDb });
}

const sampleCall = {
  id: "call-list-001",
  tenantId: "tenant-1",
  direction: "INBOUND",
  fromNumber: "+919876543210",
  toNumber: "+911234567890",
  status: "COMPLETED",
  intent: "BOOKING",
  language: "en-IN",
  durationSeconds: 120,
  startedAt: new Date("2026-05-27T10:00:00Z"),
  customer: { id: "cust-1", name: "Test Customer", mobile: "+919876543210" },
  lead: null,
  _count: { segments: 4 },
};

// ── List tests ────────────────────────────────────────────────────────────────

describe("GET /api/voice-calls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated voice calls list", async () => {
    setAuth();
    mockVoiceCallFindMany.mockResolvedValue([sampleCall]);
    mockVoiceCallCount.mockResolvedValue(1);

    const req = new NextRequest("http://localhost/api/voice-calls");
    const res = await listGET(req);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.voiceCalls)).toBe(true);
    expect((body.voiceCalls as unknown[]).length).toBe(1);
    expect(body.total).toBe(1);
  });

  it("passes status filter to DB query", async () => {
    setAuth();
    mockVoiceCallFindMany.mockResolvedValue([]);
    mockVoiceCallCount.mockResolvedValue(0);

    const req = new NextRequest("http://localhost/api/voice-calls?status=COMPLETED");
    await listGET(req);

    expect(mockVoiceCallFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockRejectedValue(new Error("Unauthorized"));
    const req = new NextRequest("http://localhost/api/voice-calls");
    const res = await listGET(req);
    expect(res.status).toBe(401);
  });
});

// ── Detail tests ──────────────────────────────────────────────────────────────

describe("GET /api/voice-calls/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  const routeContext = { params: Promise.resolve({ id: "call-list-001" }) };

  it("returns voice call with segments", async () => {
    setAuth();
    mockVoiceCallFindUnique.mockResolvedValue({
      ...sampleCall,
      conversation: null,
      segments: [
        {
          id: "seg-1", speaker: "CUSTOMER", content: "I want Goa",
          audioUrl: null, startMs: 0, endMs: 3000, createdAt: new Date(),
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/voice-calls/call-list-001");
    const res = await detailGET(req, routeContext);
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.id).toBe("call-list-001");
    expect(Array.isArray(body.segments)).toBe(true);
  });

  it("returns 404 for unknown call", async () => {
    setAuth();
    mockVoiceCallFindUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/voice-calls/ghost-call");
    const res = await detailGET(req, { params: Promise.resolve({ id: "ghost-call" }) });

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockRejectedValue(new Error("Unauthorized"));
    const req = new NextRequest("http://localhost/api/voice-calls/call-list-001");
    const res = await detailGET(req, routeContext);
    expect(res.status).toBe(401);
  });
});
