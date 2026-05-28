/**
 * src/lib/telephony/index.test.ts
 *
 * Unit tests for the telephony provider factory + adapters (Phase 6d).
 *
 * Tests cover:
 *   - getTelephonyProvider resolves correct adapter per provider type
 *   - Error cases: missing tenant, unconfigured provider, incomplete credentials
 *   - Unknown provider string throws
 *   - verifyWebhookSignature: valid HMAC accepted, tampered body/wrong secret rejected
 *   - timingSafeEqual used (bad hex length → false, not throw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

// ── Hoist mock ────────────────────────────────────────────────────────────────
const { mockTenantFindUnique } = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mockTenantFindUnique,
    },
  },
}));

import { getTelephonyProvider } from "./index";
import { ExotelAdapter } from "./exotel";
import { PlivoAdapter } from "./plivo";
import { TwilioAdapter } from "./twilio";
import { FreJunAdapter } from "./frejun";
import { NotImplementedError } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTenantMock(
  provider: string | null,
  apiKey: string | null,
  apiSecret: string | null,
) {
  mockTenantFindUnique.mockResolvedValue({
    telephonyProvider: provider,
    telephonyApiKey: apiKey,
    telephonyApiSecret: apiSecret,
  });
}

function hmacHex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function hmacBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

// ── getTelephonyProvider tests ────────────────────────────────────────────────

describe("getTelephonyProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ExotelAdapter when telephonyProvider is 'exotel'", async () => {
    setTenantMock("exotel", "key_exotel", "secret_exotel");
    const provider = await getTelephonyProvider("tenant-1");
    expect(provider).toBeInstanceOf(ExotelAdapter);
  });

  it("returns PlivoAdapter when telephonyProvider is 'plivo'", async () => {
    setTenantMock("plivo", "key_plivo", "secret_plivo");
    const provider = await getTelephonyProvider("tenant-2");
    expect(provider).toBeInstanceOf(PlivoAdapter);
  });

  it("returns TwilioAdapter when telephonyProvider is 'twilio'", async () => {
    setTenantMock("twilio", "ACxxx", "token_twilio");
    const provider = await getTelephonyProvider("tenant-3");
    expect(provider).toBeInstanceOf(TwilioAdapter);
  });

  it("throws when tenant is not found", async () => {
    mockTenantFindUnique.mockResolvedValue(null);
    await expect(getTelephonyProvider("ghost-tenant")).rejects.toThrow(
      "Tenant not found",
    );
  });

  it("throws when telephonyProvider is null", async () => {
    setTenantMock(null, "key", "secret");
    await expect(getTelephonyProvider("tenant-no-provider")).rejects.toThrow(
      "No telephony provider configured",
    );
  });

  it("throws when apiKey is missing", async () => {
    setTenantMock("exotel", null, "secret");
    await expect(getTelephonyProvider("tenant-no-key")).rejects.toThrow(
      "Telephony credentials incomplete",
    );
  });

  it("throws for an unknown provider string", async () => {
    setTenantMock("vonage", "key", "secret");
    await expect(getTelephonyProvider("tenant-vonage")).rejects.toThrow(
      "Unknown telephony provider",
    );
  });

  it("returns FreJunAdapter when telephonyProvider is 'frejun'", async () => {
    const freJunJson = JSON.stringify({
      apiToken: "frj_live_testtoken",
      callerNumber: "+919876543210",
      webhookSecret: "wh_secret_frejun",
    });
    setTenantMock("frejun", freJunJson, "-");
    const provider = await getTelephonyProvider("tenant-frejun");
    expect(provider).toBeInstanceOf(FreJunAdapter);
  });

  it("FreJun: throws when telephonyApiKey JSON is missing apiToken", async () => {
    const incompleteJson = JSON.stringify({ webhookSecret: "wh_secret" });
    setTenantMock("frejun", incompleteJson, "-");
    await expect(getTelephonyProvider("tenant-frejun-bad")).rejects.toThrow(
      "FreJun credentials incomplete",
    );
  });

  it("FreJun: throws when telephonyApiKey is not valid JSON", async () => {
    setTenantMock("frejun", "not-valid-json", "-");
    await expect(getTelephonyProvider("tenant-frejun-nonjson")).rejects.toThrow(
      "not valid JSON",
    );
  });
});

// ── ExotelAdapter.verifyWebhookSignature tests ────────────────────────────────

describe("ExotelAdapter.verifyWebhookSignature", () => {
  const adapter = new ExotelAdapter("key", "secret_exotel");
  const BODY = '{"CallSid":"xx123","Status":"completed"}';
  const SECRET = "secret_exotel";

  it("accepts a valid HMAC-SHA256 hex signature", () => {
    const sig = hmacHex(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacHex(BODY, SECRET);
    expect(
      adapter.verifyWebhookSignature(BODY.replace("completed", "ringing"), sig, SECRET),
    ).toBe(false);
  });

  it("rejects wrong secret", () => {
    const sig = hmacHex(BODY, "wrong_secret");
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("returns false for null signature (missing header)", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });

  it("returns false for empty body", () => {
    expect(adapter.verifyWebhookSignature("", hmacHex(BODY, SECRET), SECRET)).toBe(false);
  });

  it("returns false for bad-length hex (timingSafeEqual guard)", () => {
    expect(adapter.verifyWebhookSignature(BODY, "zzz_not_hex", SECRET)).toBe(false);
  });
});

// ── PlivoAdapter.verifyWebhookSignature tests ─────────────────────────────────

describe("PlivoAdapter.verifyWebhookSignature", () => {
  const adapter = new PlivoAdapter("auth_id", "auth_token_plivo");
  const BODY = '{"From":"+91999","To":"+91888"}';
  const SECRET = "auth_token_plivo";

  it("accepts a valid HMAC-SHA256 base64 signature", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects tampered body", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(
      adapter.verifyWebhookSignature(BODY.replace("999", "000"), sig, SECRET),
    ).toBe(false);
  });

  it("rejects null signature", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });
});

// ── TwilioAdapter.verifyWebhookSignature tests ────────────────────────────────

describe("TwilioAdapter.verifyWebhookSignature", () => {
  const adapter = new TwilioAdapter("ACsid", "auth_token_twilio");
  const BODY = '{"CallSid":"CA123","CallStatus":"in-progress"}';
  const SECRET = "auth_token_twilio";

  it("accepts a valid HMAC-SHA256 base64 signature", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects wrong secret", () => {
    const sig = hmacBase64(BODY, "other_secret");
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("rejects null signature", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });
});

// ── NotImplementedError / stub tests ─────────────────────────────────────────

describe("Adapter stub / error behaviour", () => {
  it("ExotelAdapter.placeCall throws when apiKey is not valid JSON (bad tenant config)", async () => {
    // Exotel now makes real REST calls; it throws a config error (not NotImplementedError)
    // when telephonyApiKey is not JSON-formatted { accountSid, apiKey, apiToken }.
    const adapter = new ExotelAdapter("not-json-key", "secret");
    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("telephonyApiKey must be a JSON string");
  });

  it("placeCall throws NotImplementedError on PlivoAdapter", async () => {
    const adapter = new PlivoAdapter("id", "token");
    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("placeCall throws NotImplementedError on TwilioAdapter", async () => {
    const adapter = new TwilioAdapter("ACsid", "token");
    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("ExotelAdapter.hangup throws when apiKey is not valid JSON", async () => {
    // Exotel hangup now makes real REST calls; bad config → config error.
    const adapter = new ExotelAdapter("not-json-key", "secret");
    await expect(adapter.hangup("call-sid-1")).rejects.toThrow(
      "telephonyApiKey must be a JSON string",
    );
  });

  it("ExotelAdapter.transferToAgent throws NotImplementedError (XML approach required)", async () => {
    const creds = JSON.stringify({ accountSid: "AC1", apiKey: "k", apiToken: "t" });
    const adapter = new ExotelAdapter(creds, "secret");
    await expect(adapter.transferToAgent("sid-1", "+91")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("startRecording throws NotImplementedError on TwilioAdapter", async () => {
    const adapter = new TwilioAdapter("ACsid", "token");
    await expect(adapter.startRecording("CA_call_1")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("stopRecording throws NotImplementedError on PlivoAdapter", async () => {
    const adapter = new PlivoAdapter("id", "token");
    await expect(adapter.stopRecording("uuid-call-1")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});
