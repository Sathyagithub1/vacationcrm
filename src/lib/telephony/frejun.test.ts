/**
 * src/lib/telephony/frejun.test.ts
 *
 * Unit tests for the FreJunAdapter (Phase 6f).
 *
 * Tests cover:
 *   - constructor: adapter constructed with creds + webhookSecret
 *   - placeCall: POSTs to /calls with Bearer auth + JSON body
 *   - placeCall: body is JSON-encoded (NOT form-urlencoded)
 *   - placeCall: returns callSid from response.call_id
 *   - placeCall: throws when apiToken is missing (empty creds)
 *   - placeCall: falls back to callerNumber when from is empty
 *   - placeCall: throws when FreJun API returns 4xx error
 *   - hangup: sends DELETE to /calls/{callSid} with Bearer auth
 *   - hangup: throws on FreJun API error
 *   - transferToAgent: POSTs to /calls/{callSid}/transfer with { to } JSON body
 *   - transferToAgent: uses Bearer auth (not Basic)
 *   - startRecording: POSTs to /calls/{callSid}/recording/start, returns recordingId
 *   - stopRecording: POSTs to /calls/{callSid}/recording/stop, returns recording_url
 *   - playTts: is a no-op (does not call fetch)
 *   - verifyWebhookSignature: accepts valid HMAC-SHA256 hex signature
 *   - verifyWebhookSignature: rejects tampered body
 *   - verifyWebhookSignature: rejects wrong secret
 *   - verifyWebhookSignature: returns false for null signature
 *   - verifyWebhookSignature: returns false for bad hex (timingSafeEqual guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { FreJunAdapter } from "./frejun";

// ── Helpers ───────────────────────────────────────────────────────────────────

function hmacHex(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

const WEBHOOK_SECRET = "wh_secret_frejun_test";

const VALID_CREDS = {
  apiToken: "frj_live_testtoken123",
  callerNumber: "+919876543210",
};

/** Expected Bearer auth header value */
function expectedBearerAuth(): string {
  return "Bearer frj_live_testtoken123";
}

// ── constructor ───────────────────────────────────────────────────────────────

describe("FreJunAdapter constructor", () => {
  it("constructs without throwing when given valid creds and webhookSecret", () => {
    expect(() => new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET)).not.toThrow();
  });
});

// ── placeCall tests ───────────────────────────────────────────────────────────

describe("FreJunAdapter.placeCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /calls with Bearer auth header", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ call_id: "FJ_CALL_001", status: "initiated" }),
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
    expect(url).toBe("https://api.frejun.com/v1/calls");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBearerAuth(),
    );
    expect(init.method).toBe("POST");
  });

  it("sends body as JSON (not form-urlencoded)", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ call_id: "FJ_CALL_002", status: "initiated" }),
        { status: 200 },
      ),
    );

    await adapter.placeCall({
      from: "+919876543210",
      to: "+911234567890",
      webhookUrl: "https://crm.example.com/webhook",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Must be JSON-parseable — NOT URLSearchParams-encoded
    expect(() => JSON.parse(init.body as string)).not.toThrow();
    const parsed = JSON.parse(init.body as string) as {
      from: string;
      to: string;
      callback_url: string;
    };
    expect(parsed.from).toBe("+919876543210");
    expect(parsed.to).toBe("+911234567890");
    expect(parsed.callback_url).toBe("https://crm.example.com/webhook");
    // Must NOT contain percent-encoded characters (would indicate form encoding)
    expect(init.body as string).not.toContain("%2B");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("returns callSid from response.call_id", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ call_id: "FJ_SID_XYZ", status: "initiated" }),
        { status: 200 },
      ),
    );

    const result = await adapter.placeCall({
      from: "+91",
      to: "+91",
      webhookUrl: "https://example.com/webhook",
    });

    expect(result.callSid).toBe("FJ_SID_XYZ");
  });

  it("falls back to callerNumber when from is empty string", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ call_id: "FJ_FALLBACK", status: "initiated" }),
        { status: 200 },
      ),
    );

    await adapter.placeCall({
      from: "",
      to: "+911234567890",
      webhookUrl: "https://example.com/webhook",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as { from: string };
    // Should fall back to the callerNumber configured in creds
    expect(parsed.from).toBe("+919876543210");
  });

  it("throws when FreJun API returns 4xx error", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "Invalid phone number" }),
        { status: 400 },
      ),
    );

    await expect(
      adapter.placeCall({ from: "bad", to: "+91", webhookUrl: "https://x.com" }),
    ).rejects.toThrow("[FreJun] API error 400");
  });
});

// ── hangup tests ──────────────────────────────────────────────────────────────

describe("FreJunAdapter.hangup", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends DELETE to /calls/{callSid} with Bearer auth", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await adapter.hangup("FJ_SID_DEL");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.frejun.com/v1/calls/FJ_SID_DEL");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      expectedBearerAuth(),
    );
  });

  it("throws when DELETE returns an error status", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    await expect(adapter.hangup("nonexistent-call")).rejects.toThrow("DELETE");
  });
});

// ── transferToAgent tests ─────────────────────────────────────────────────────

describe("FreJunAdapter.transferToAgent", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to /calls/{callSid}/transfer with JSON body { to }", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "transferred" }), { status: 200 }),
    );

    await adapter.transferToAgent("FJ_CALL_001", "+911234567890");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.frejun.com/v1/calls/FJ_CALL_001/transfer");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as { to: string };
    expect(body.to).toBe("+911234567890");
  });

  it("uses Bearer auth (not Basic) for transfer", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "transferred" }), { status: 200 }),
    );

    await adapter.transferToAgent("FJ_CALL_002", "+91");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Record<string, string>)["Authorization"];
    expect(authHeader).toMatch(/^Bearer /);
    expect(authHeader).not.toMatch(/^Basic /);
  });
});

// ── startRecording / stopRecording tests ──────────────────────────────────────

describe("FreJunAdapter recording", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("startRecording POSTs to /calls/{callSid}/recording/start and returns recordingId", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "recording_started" }), { status: 200 }),
    );

    const result = await adapter.startRecording("FJ_REC_001");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.frejun.com/v1/calls/FJ_REC_001/recording/start");
    // recordingId should be the callSid itself (FreJun assumption)
    expect(result.recordingId).toBe("FJ_REC_001");
  });

  it("stopRecording POSTs to /calls/{callSid}/recording/stop and returns recordingUrl", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ recording_url: "https://storage.frejun.com/rec/FJ_REC_001.mp3" }),
        { status: 200 },
      ),
    );

    const result = await adapter.stopRecording("FJ_REC_001");

    expect(result.recordingUrl).toBe(
      "https://storage.frejun.com/rec/FJ_REC_001.mp3",
    );
  });

  it("stopRecording falls back to empty string if recording_url is absent", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "stopped" }), { status: 200 }),
    );

    const result = await adapter.stopRecording("FJ_REC_002");
    expect(result.recordingUrl).toBe("");
  });
});

// ── playTts (XML-level no-op) ─────────────────────────────────────────────────

describe("FreJunAdapter.playTts (XML-level no-op)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("playTts is a no-op (does not call fetch)", async () => {
    const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);
    const mockFetch = vi.spyOn(global, "fetch");
    await expect(
      adapter.playTts("FJ_CALL_001", "Hello world", "en-IN"),
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── verifyWebhookSignature tests ──────────────────────────────────────────────

describe("FreJunAdapter.verifyWebhookSignature", () => {
  const adapter = new FreJunAdapter(VALID_CREDS, WEBHOOK_SECRET);
  const BODY = '{"call_id":"FJ123","status":"completed"}';
  const SECRET = WEBHOOK_SECRET;

  it("accepts a valid HMAC-SHA256 hex signature", () => {
    const sig = hmacHex(BODY, SECRET);
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacHex(BODY, SECRET);
    expect(
      adapter.verifyWebhookSignature(
        BODY.replace("completed", "ringing"),
        sig,
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects wrong secret", () => {
    const sig = hmacHex(BODY, "wrong_secret");
    expect(adapter.verifyWebhookSignature(BODY, sig, SECRET)).toBe(false);
  });

  it("returns false for null signature (missing X-Frejun-Signature header)", () => {
    expect(adapter.verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
  });

  it("returns false for bad-length hex string (timingSafeEqual guard)", () => {
    expect(adapter.verifyWebhookSignature(BODY, "zzz_not_valid_hex", SECRET)).toBe(
      false,
    );
  });

  it("returns false for empty body", () => {
    expect(adapter.verifyWebhookSignature("", hmacHex(BODY, SECRET), SECRET)).toBe(
      false,
    );
  });
});
