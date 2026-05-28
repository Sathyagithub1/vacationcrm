/**
 * src/lib/telephony/exotel.test.ts
 *
 * Unit tests for the ExotelAdapter (Phase 6f).
 *
 * Tests cover:
 *   - placeCall: sends POST with correct form params + Basic auth header
 *   - placeCall: returns callSid from response.Call.Sid
 *   - placeCall: throws on non-JSON apiKey (bad credential shape)
 *   - placeCall: throws on Exotel API 4xx error
 *   - hangup: sends DELETE to correct URL with Basic auth
 *   - hangup: throws on Exotel API error
 *   - transferToAgent: throws NotImplementedError (XML approach required)
 *   - playTts: is a no-op (returns void, no fetch call)
 *   - startRecording: is a no-op (returns stub recordingId)
 *   - stopRecording: is a no-op (returns empty recordingUrl)
 *   - verifyWebhookSignature: valid hex HMAC accepted
 *   - verifyWebhookSignature: tampered body rejected
 *   - verifyWebhookSignature: wrong secret rejected
 *   - verifyWebhookSignature: null signature returns false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { ExotelAdapter } from "./exotel";
import { NotImplementedError } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hmacHex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Valid Exotel credentials JSON (as stored in telephonyApiKey after decryption) */
const VALID_CREDS = JSON.stringify({
  accountSid: "ACTEST123",
  apiKey: "exo_key_abc",
  apiToken: "exo_token_xyz",
});

const WEBHOOK_SECRET = "wh_secret_exotel";

/** Expected Basic auth header value */
function expectedBasicAuth(): string {
  return "Basic " + Buffer.from("exo_key_abc:exo_token_xyz").toString("base64");
}

// ── placeCall tests ───────────────────────────────────────────────────────────

describe("ExotelAdapter.placeCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to correct Exotel endpoint with form-encoded params", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ Call: { Sid: "EX_SID_001" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await adapter.placeCall({
      from: "+919876543210",
      to: "+911234567890",
      webhookUrl: "https://crm.example.com/api/webhooks/voice/tok/turn",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.exotel.com/v1/Accounts/ACTEST123/Calls/connect.json");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(expectedBasicAuth());
    expect(init.method).toBe("POST");
    // Body should be form-urlencoded
    expect(init.body as string).toContain("From=%2B919876543210");
    expect(init.body as string).toContain("To=%2B911234567890");
    expect(init.body as string).toContain("CallerId=%2B919876543210");
  });

  it("returns callSid from response.Call.Sid", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ Call: { Sid: "EX_CALL_SID_XYZ" } }),
        { status: 200 },
      ),
    );

    const result = await adapter.placeCall({
      from: "+91",
      to: "+91",
      webhookUrl: "https://example.com/webhook",
    });

    expect(result.callSid).toBe("EX_CALL_SID_XYZ");
  });

  it("throws when telephonyApiKey is not valid JSON", async () => {
    const adapter = new ExotelAdapter("not-json-key", WEBHOOK_SECRET);
    await expect(
      adapter.placeCall({ from: "+91", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("telephonyApiKey must be a JSON string");
  });

  it("throws when Exotel API returns 4xx error", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ RestException: { Message: "Invalid phone number format" } }),
        { status: 400 },
      ),
    );

    await expect(
      adapter.placeCall({ from: "invalid", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("Exotel] API error 400");
  });
});

// ── hangup tests ──────────────────────────────────────────────────────────────

describe("ExotelAdapter.hangup", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends DELETE to /Calls/{callSid}.json with Basic auth", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await adapter.hangup("EX_SID_DEL");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.exotel.com/v1/Accounts/ACTEST123/Calls/EX_SID_DEL.json");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(expectedBasicAuth());
  });

  it("throws when DELETE returns error status", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    await expect(adapter.hangup("nonexistent-sid")).rejects.toThrow("DELETE");
  });
});

// ── transferToAgent tests ─────────────────────────────────────────────────────

describe("ExotelAdapter.transferToAgent", () => {
  it("throws NotImplementedError with XML guidance", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
    await expect(
      adapter.transferToAgent("sid-001", "+911234567890"),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("error message mentions IVR XML approach", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
    try {
      await adapter.transferToAgent("sid-001", "+91");
    } catch (e) {
      expect((e as Error).message).toContain("ExoML");
    }
  });
});

// ── playTts / startRecording / stopRecording (XML-level no-ops) ───────────────

describe("ExotelAdapter XML-level methods", () => {
  it("playTts is a no-op (does not call fetch)", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
    const mockFetch = vi.spyOn(global, "fetch");
    await expect(adapter.playTts("sid-1", "Hello world", "en-IN")).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("startRecording returns stub recordingId without fetch", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
    const mockFetch = vi.spyOn(global, "fetch");
    const result = await adapter.startRecording("sid-1");
    expect(result.recordingId).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stopRecording returns without fetch", async () => {
    const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
    const mockFetch = vi.spyOn(global, "fetch");
    const result = await adapter.stopRecording("sid-1");
    expect(typeof result.recordingUrl).toBe("string");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── verifyWebhookSignature tests ──────────────────────────────────────────────

describe("ExotelAdapter.verifyWebhookSignature", () => {
  const adapter = new ExotelAdapter(VALID_CREDS, WEBHOOK_SECRET);
  const BODY = '{"CallSid":"EX123","Status":"completed"}';
  const SECRET = WEBHOOK_SECRET;

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

  it("returns false for null signature", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });
});
