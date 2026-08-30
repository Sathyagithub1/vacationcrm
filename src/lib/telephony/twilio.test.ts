/**
 * src/lib/telephony/twilio.test.ts
 *
 * Unit tests for the TwilioAdapter (Phase 6h).
 *
 * All network access is mocked (global.fetch); NO database is touched.
 *
 * Tests cover:
 *   - placeCall: POSTs to Calls.json with correct form params + Basic auth
 *   - placeCall: returns callSid from response.sid
 *   - placeCall: throws when credentials are missing
 *   - placeCall: throws on Twilio API 4xx error (uses `message` field)
 *   - hangup: POSTs to /Calls/{CallSid}.json with Status=completed + Basic auth
 *   - hangup: throws on Twilio API error
 *   - transferToAgent / playTts / startRecording / stopRecording:
 *       throw NotImplementedError (TwiML-level)
 *   - verifyWebhookSignature: valid base64 HMAC accepted
 *   - verifyWebhookSignature: tampered body rejected
 *   - verifyWebhookSignature: wrong secret rejected
 *   - verifyWebhookSignature: null signature returns false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { TwilioAdapter } from "./twilio";
import { NotImplementedError } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hmacBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

// Twilio: telephonyApiKey = Account SID, telephonyApiSecret = Auth Token.
const ACCOUNT_SID = "ACtest1234567890";
const AUTH_TOKEN = "tw_auth_token_secret";

/** Expected Basic auth header value: Base64("AccountSid:AuthToken") */
function expectedBasicAuth(): string {
  return "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
}

// ── placeCall tests ───────────────────────────────────────────────────────────

describe("TwilioAdapter.placeCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to correct Twilio endpoint with form-encoded params + Basic auth", async () => {
    const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ sid: "CA_SID_001", status: "queued" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    await adapter.placeCall({
      from: "+919876543210",
      to: "+911234567890",
      webhookUrl: "https://crm.example.com/api/webhooks/voice/tok/turn",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBasicAuth(),
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    // Body should be form-urlencoded From/To/Url
    expect(init.body as string).toContain("From=%2B919876543210");
    expect(init.body as string).toContain("To=%2B911234567890");
    expect(init.body as string).toContain(
      "Url=https%3A%2F%2Fcrm.example.com%2Fapi%2Fwebhooks%2Fvoice%2Ftok%2Fturn",
    );
  });

  it("returns callSid from response.sid", async () => {
    const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ sid: "CA_CALL_SID_XYZ" }), { status: 201 }),
    );

    const result = await adapter.placeCall({
      from: "+91",
      to: "+91",
      webhookUrl: "https://example.com/webhook",
    });

    expect(result.callSid).toBe("CA_CALL_SID_XYZ");
  });

  it("throws when credentials are missing (no network call)", async () => {
    const adapter = new TwilioAdapter("", AUTH_TOKEN);
    const mockFetch = vi.spyOn(global, "fetch");

    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("Missing credentials");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when Twilio API returns 4xx error (uses message field)", async () => {
    const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 21211,
          message: "The 'To' number is not a valid phone number.",
          status: 400,
        }),
        { status: 400 },
      ),
    );

    await expect(
      adapter.placeCall({ from: "+91", to: "invalid", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("Twilio] API error 400");
  });
});

// ── hangup tests ──────────────────────────────────────────────────────────────

describe("TwilioAdapter.hangup", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs Status=completed to /Calls/{CallSid}.json with Basic auth", async () => {
    const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ sid: "CA_SID_DEL", status: "completed" }),
        { status: 200 },
      ),
    );

    await adapter.hangup("CA_SID_DEL");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls/CA_SID_DEL.json`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBasicAuth(),
    );
    expect(init.body as string).toContain("Status=completed");
  });

  it("throws when Twilio API returns error status", async () => {
    const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 20404, message: "The requested resource was not found" }),
        { status: 404 },
      ),
    );

    await expect(adapter.hangup("nonexistent-sid")).rejects.toThrow(
      "Twilio] API error 404",
    );
  });
});

// ── TwiML-level methods (still stubbed) ───────────────────────────────────────

describe("TwilioAdapter TwiML-level methods throw NotImplementedError", () => {
  const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);

  it("transferToAgent throws NotImplementedError", async () => {
    await expect(
      adapter.transferToAgent("sid-001", "+911234567890"),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("playTts throws NotImplementedError", async () => {
    await expect(
      adapter.playTts("sid-001", "Hello world", "en-IN"),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("startRecording throws NotImplementedError", async () => {
    await expect(adapter.startRecording("sid-001")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("stopRecording throws NotImplementedError", async () => {
    await expect(adapter.stopRecording("sid-001")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

// ── verifyWebhookSignature tests ──────────────────────────────────────────────

describe("TwilioAdapter.verifyWebhookSignature", () => {
  const adapter = new TwilioAdapter(ACCOUNT_SID, AUTH_TOKEN);
  const BODY = '{"CallSid":"CA123","CallStatus":"completed"}';
  const SECRET = AUTH_TOKEN;

  it("accepts a valid HMAC-SHA256 base64 signature", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(
      adapter.verifyWebhookSignature(BODY.replace("completed", "ringing"), sig, SECRET),
    ).toBe(false);
  });

  it("rejects wrong secret", () => {
    const sig = hmacBase64(BODY, "wrong_secret");
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("returns false for null signature", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });
});
