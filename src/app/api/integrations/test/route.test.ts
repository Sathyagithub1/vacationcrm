/**
 * src/app/api/integrations/test/route.test.ts
 *
 * Phase 6k — Tests for POST /api/integrations/test.
 * All external calls (prisma, fetch, nodemailer) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockRequirePermission, mockTenantFindUnique, mockVerify, mockCreateTransport } =
  vi.hoisted(() => ({
    mockRequirePermission: vi.fn(),
    mockTenantFindUnique: vi.fn(),
    mockVerify: vi.fn(),
    mockCreateTransport: vi.fn(),
  }));

vi.mock("@/modules/auth/tenant.middleware", () => ({
  requirePermission: mockRequirePermission,
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { tenant: { findUnique: mockTenantFindUnique } },
}));

// decrypt is a no-op passthrough in tests
vi.mock("@/lib/crypto/credential-encryption", () => ({
  decryptIfEncrypted: (v: string) => v,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

import { POST } from "./route";

function req(provider: unknown): NextRequest {
  return new NextRequest("http://localhost/api/integrations/test", {
    method: "POST",
    body: JSON.stringify({ provider }),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({ user: { id: "u1", tenantId: "t1", role: "COMPANY_ADMIN" } });
  mockCreateTransport.mockReturnValue({ verify: mockVerify });
  vi.stubGlobal("fetch", vi.fn());
});

describe("POST /api/integrations/test — auth", () => {
  it("returns 403 when permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    const res = await POST(req("razorpay"));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an unknown provider", async () => {
    const res = await POST(req("bogus"));
    expect(res.status).toBe(400);
  });
});

describe("Razorpay", () => {
  it("passes when the API returns 200", async () => {
    mockTenantFindUnique.mockResolvedValue({ razorpayKeyId: "rzp_test_abc", razorpayKeySecret: "sek" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const json = await (await POST(req("razorpay"))).json();
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/test mode/i);
  });

  it("fails on 401", async () => {
    mockTenantFindUnique.mockResolvedValue({ razorpayKeyId: "rzp_live_x", razorpayKeySecret: "bad" });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 });
    const json = await (await POST(req("razorpay"))).json();
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/rejected/i);
  });

  it("reports not-configured when keys are missing", async () => {
    mockTenantFindUnique.mockResolvedValue({ razorpayKeyId: null, razorpayKeySecret: null });
    const json = await (await POST(req("razorpay"))).json();
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/isn't configured/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("SMTP", () => {
  it("passes when transporter.verify() resolves", async () => {
    mockTenantFindUnique.mockResolvedValue({
      emailTemplateConfig: { smtpHost: "smtp.x.com", smtpPort: "587", smtpUser: "u", smtpPass: "p" },
    });
    mockVerify.mockResolvedValue(true);
    const json = await (await POST(req("smtp"))).json();
    expect(json.ok).toBe(true);
    expect(mockVerify).toHaveBeenCalled();
  });

  it("fails when verify() throws", async () => {
    mockTenantFindUnique.mockResolvedValue({
      emailTemplateConfig: { smtpHost: "smtp.x.com", smtpUser: "u", smtpPass: "p" },
    });
    mockVerify.mockRejectedValue(new Error("Invalid login: 535"));
    const json = await (await POST(req("smtp"))).json();
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/535/);
  });

  it("reports not-configured when SMTP fields are missing", async () => {
    mockTenantFindUnique.mockResolvedValue({ emailTemplateConfig: { smtpHost: "" } });
    const json = await (await POST(req("smtp"))).json();
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/isn't fully configured/i);
  });
});

describe("Telephony (Exotel)", () => {
  it("passes when Exotel account GET returns 200", async () => {
    mockTenantFindUnique.mockResolvedValue({
      telephonyProvider: "EXOTEL",
      telephonyApiKey: JSON.stringify({ accountSid: "AC1", apiKey: "k", apiToken: "tk" }),
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const json = await (await POST(req("telephony"))).json();
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/exotel/i);
  });

  it("fails when Exotel returns 401", async () => {
    mockTenantFindUnique.mockResolvedValue({
      telephonyProvider: "EXOTEL",
      telephonyApiKey: JSON.stringify({ accountSid: "AC1", apiKey: "k", apiToken: "bad" }),
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 });
    const json = await (await POST(req("telephony"))).json();
    expect(json.ok).toBe(false);
  });
});

describe("Google TTS / STT", () => {
  it("TTS passes on 200", async () => {
    mockTenantFindUnique.mockResolvedValue({ ttsApiKey: "gkey", sttApiKey: null });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
    const json = await (await POST(req("tts"))).json();
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/valid/i);
  });

  it("STT fails on invalid key (400 API_KEY_INVALID)", async () => {
    mockTenantFindUnique.mockResolvedValue({ sttApiKey: "badkey", ttsApiKey: null });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "API key not valid. Please pass a valid API key." } }),
    });
    const json = await (await POST(req("stt"))).json();
    expect(json.ok).toBe(false);
    expect(json.message).toMatch(/invalid/i);
  });
});
