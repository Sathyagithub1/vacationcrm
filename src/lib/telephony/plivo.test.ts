/**
 * src/lib/telephony/plivo.test.ts
 *
 * Unit tests for the PlivoAdapter (Phase 6h).
 *
 * There is NO database in the test environment — the adapter is constructed
 * directly with (authId, authToken) and global.fetch is mocked, exactly as the
 * ExotelAdapter tests do.
 *
 * Tests cover:
 *   - placeCall: POSTs to correct Plivo endpoint with JSON body + Basic auth
 *   - placeCall: normalizes request_uuid → callSid
 *   - placeCall: throws when credentials are missing
 *   - placeCall: throws on Plivo API 4xx error
 *   - hangup: sends DELETE to /Call/{uuid}/ with Basic auth
 *   - hangup: throws on Plivo API error
 *   - transferToAgent: throws NotImplementedError
 *   - playTts / startRecording / stopRecording: throw NotImplementedError
 *   - verifyWebhookSignature: valid base64 HMAC accepted
 *   - verifyWebhookSignature: tampered body rejected
 *   - verifyWebhookSignature: wrong secret rejected
 *   - verifyWebhookSignature: null signature returns false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { PlivoAdapter } from "./plivo";
import { NotImplementedError } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hmacBase64(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

/** Plivo credentials as passed by the factory: (authId, authToken). */
const AUTH_ID = "MATESTAUTHID1234";
const AUTH_TOKEN = "plivo_token_secret_xyz";

/** Expected Basic auth header value: Base64("authId:authToken"). */
function expectedBasicAuth(): string {
  return "Basic " + Buffer.from(`${AUTH_ID}:${AUTH_TOKEN}`).toString("base64");
}

// ── placeCall tests ───────────────────────────────────────────────────────────

describe("PlivoAdapter.placeCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to correct Plivo endpoint with JSON body + Basic auth", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: "call fired",
          request_uuid: "PLV_REQ_001",
          api_id: "api-1",
        }),
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
    expect(url).toBe(`https://api.plivo.com/v1/Account/${AUTH_ID}/Call/`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBasicAuth(),
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    // Body is JSON with from/to/answer_url
    const parsedBody = JSON.parse(init.body as string) as Record<string, string>;
    expect(parsedBody).toEqual({
      from: "+919876543210",
      to: "+911234567890",
      answer_url: "https://crm.example.com/api/webhooks/voice/tok/turn",
    });
  });

  it("normalizes request_uuid to callSid", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "call fired", request_uuid: "PLV_UUID_XYZ" }),
        { status: 201 },
      ),
    );

    const result = await adapter.placeCall({
      from: "+91",
      to: "+91",
      webhookUrl: "https://example.com/webhook",
    });

    expect(result.callSid).toBe("PLV_UUID_XYZ");
  });

  it("throws when credentials are missing", async () => {
    const adapter = new PlivoAdapter("", "");
    const mockFetch = vi.spyOn(global, "fetch");
    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("Missing credentials");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when Plivo API returns 4xx error", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "the number is not a valid phone number" }),
        { status: 400 },
      ),
    );

    await expect(
      adapter.placeCall({ from: "invalid", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("Plivo] API error 400");
  });
});

// ── hangup tests ──────────────────────────────────────────────────────────────

describe("PlivoAdapter.hangup", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends DELETE to /Call/{uuid}/ with Basic auth", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await adapter.hangup("PLV_CALL_DEL");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.plivo.com/v1/Account/${AUTH_ID}/Call/PLV_CALL_DEL/`,
    );
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBasicAuth(),
    );
  });

  it("throws when DELETE returns error status", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    await expect(adapter.hangup("nonexistent-uuid")).rejects.toThrow("DELETE");
  });

  it("throws (without fetch) when callSid is empty", async () => {
    const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);
    const mockFetch = vi.spyOn(global, "fetch");
    await expect(adapter.hangup("")).rejects.toThrow("requires a call UUID");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── still-stubbed methods ─────────────────────────────────────────────────────

describe("PlivoAdapter stubbed methods", () => {
  const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);

  it("transferToAgent throws NotImplementedError", async () => {
    await expect(
      adapter.transferToAgent("uuid-001", "+911234567890"),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("playTts throws NotImplementedError", async () => {
    await expect(
      adapter.playTts("uuid-001", "Hello", "en-IN"),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("startRecording throws NotImplementedError", async () => {
    await expect(adapter.startRecording("uuid-001")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it("stopRecording throws NotImplementedError", async () => {
    await expect(adapter.stopRecording("uuid-001")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

// ── verifyWebhookSignature tests ──────────────────────────────────────────────

describe("PlivoAdapter.verifyWebhookSignature", () => {
  const adapter = new PlivoAdapter(AUTH_ID, AUTH_TOKEN);
  const BODY = '{"CallUUID":"PLV123","Event":"Hangup"}';
  const SECRET = AUTH_TOKEN;

  it("accepts a valid HMAC-SHA256 base64 signature", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacBase64(BODY, SECRET);
    expect(
      adapter.verifyWebhookSignature(BODY.replace("Hangup", "Answer"), sig, SECRET),
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
