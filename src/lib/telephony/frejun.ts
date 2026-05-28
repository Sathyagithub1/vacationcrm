/**
 * src/lib/telephony/frejun.ts
 *
 * FreJun telephony adapter (Phase 6f).
 *
 * FreJun is an India-focused cloud telephony provider used by sales and
 * support teams. API docs: https://docs.frejun.com
 *
 * Authentication:
 *   Bearer token in the `Authorization: Bearer <apiToken>` header.
 *   The API token is obtained from the FreJun dashboard.
 *
 * Tenant credential shape (telephonyApiKey field stores JSON):
 *   telephonyApiKey: encrypted JSON string
 *     `{ "apiToken": "...", "callerNumber": "+91xxxxxxxxxx", "webhookSecret": "..." }`
 *   telephonyApiSecret: not used for FreJun (kept for interface compat — set to any non-empty string)
 *
 * Call-control approach:
 *   - placeCall:        REST  POST  /calls              (Bearer + JSON body)
 *   - hangup:           REST  DELETE /calls/{call_id}
 *   - transferToAgent:  REST  POST  /calls/{call_id}/transfer  (JSON body { to })
 *   - startRecording:   REST  POST  /calls/{call_id}/recording/start
 *   - stopRecording:    REST  POST  /calls/{call_id}/recording/stop → { recording_url }
 *   - playTts:          XML-level only (no REST endpoint) — webhook response <Speak> verb
 *
 * Webhook signature:
 *   Header: X-Frejun-Signature
 *   Algorithm: HMAC-SHA256 of the raw request body, hex-encoded, using webhookSecret.
 *
 * FreJun assumptions (verify against live FreJun docs if any detail needs updating):
 *   // FreJun assumption: POST /calls body is { from, to, callback_url } and
 *   //   the response contains { call_id, status }.
 *   // FreJun assumption: DELETE /calls/{call_id} returns 200 or 204 on success.
 *   // FreJun assumption: POST /calls/{call_id}/transfer body is { to: agentNumber }.
 *   // FreJun assumption: POST /calls/{call_id}/recording/start returns 200 on success.
 *   // FreJun assumption: POST /calls/{call_id}/recording/stop returns { recording_url }.
 *   // FreJun assumption: HMAC-SHA256 signature is hex-encoded (not base64).
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";

// ── Constants ──────────────────────────────────────────────────────────────────

const FREJUN_BASE = "https://api.frejun.com/v1";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Shape of the JSON stored in `telephonyApiKey` for FreJun tenants.
 * Decrypt the field via `decryptIfEncrypted` before parsing.
 *
 * Example (plaintext before encryption):
 *   {
 *     "apiToken": "frj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "callerNumber": "+919876543210",
 *     "webhookSecret": "wh_secret_abcdefgh"
 *   }
 */
export interface FreJunCredentials {
  /** Bearer API token from the FreJun dashboard. */
  apiToken: string;
  /** Default outbound caller number (E.164 format). Optional — FreJun may use the account default. */
  callerNumber?: string;
}

// ── Adapter ────────────────────────────────────────────────────────────────────

export class FreJunAdapter implements TelephonyProvider {
  /**
   * @param creds          FreJun API credentials (apiToken, optional callerNumber).
   * @param webhookSecret  Tenant's FreJun webhook secret used for HMAC-SHA256 signature verification.
   */
  constructor(
    private readonly creds: FreJunCredentials,
    private readonly webhookSecret: string,
  ) {}

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * Build the `Authorization` Bearer header value.
   */
  private bearerAuth(): string {
    return `Bearer ${this.creds.apiToken}`;
  }

  /**
   * Make an authenticated JSON POST to the FreJun API.
   * Returns the parsed JSON response.
   * Throws a tagged Error on HTTP 4xx/5xx or non-JSON response.
   */
  private async frejunPost<T>(path: string, body: Record<string, string>): Promise<T> {
    const url = `${FREJUN_BASE}${path}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.bearerAuth(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`[FreJun] Non-JSON response (${res.status}): ${text}`);
    }

    if (!res.ok) {
      const err = parsed as { message?: string; error?: string };
      const msg = err?.message ?? err?.error ?? text;
      throw new Error(`[FreJun] API error ${res.status}: ${msg}`);
    }

    return parsed;
  }

  /**
   * Make an authenticated DELETE to the FreJun API.
   * Throws a tagged Error on HTTP 4xx/5xx.
   */
  private async frejunDelete(path: string): Promise<void> {
    const url = `${FREJUN_BASE}${path}`;

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: this.bearerAuth(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[FreJun] DELETE ${path} failed ${res.status}: ${text}`);
    }
  }

  // ── TelephonyProvider interface ──────────────────────────────────────────────

  /**
   * Initiate an outbound call via FreJun REST API.
   *
   * POST /calls
   * Body (JSON): { from, to, callback_url }
   *
   * // FreJun assumption: response contains { call_id, status }.
   * Returns the FreJun call_id mapped to our `callSid` field.
   */
  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    // FreJun assumption: `from` falls back to the tenant's configured callerNumber.
    const from = opts.from || this.creds.callerNumber ?? "";

    if (!from) {
      throw new Error(
        "[FreJun] placeCall requires a `from` number or a configured `callerNumber` " +
          "in the FreJun tenant credentials.",
      );
    }

    // FreJun assumption: POST /calls body shape is { from, to, callback_url }.
    const response = await this.frejunPost<{ call_id: string; status: string }>(
      "/calls",
      {
        from,
        to: opts.to,
        callback_url: opts.webhookUrl,
      },
    );

    return { callSid: response.call_id };
  }

  /**
   * Hang up an in-progress call via FreJun REST API.
   *
   * DELETE /calls/{call_id}
   *
   * // FreJun assumption: DELETE returns 200 or 204 on success.
   */
  async hangup(callSid: string): Promise<void> {
    await this.frejunDelete(`/calls/${callSid}`);
  }

  /**
   * Transfer the active call to a human agent via FreJun REST API.
   *
   * POST /calls/{call_id}/transfer
   * Body (JSON): { to: agentNumber }
   *
   * // FreJun assumption: POST /calls/{call_id}/transfer accepts { to } and
   * //   returns 200 on success.
   */
  async transferToAgent(callSid: string, agentNumber: string): Promise<void> {
    await this.frejunPost<Record<string, unknown>>(`/calls/${callSid}/transfer`, {
      to: agentNumber,
    });
  }

  /**
   * Play TTS mid-call.
   *
   * NOTE: FreJun TTS is delivered via the <Speak> verb in the IVR webhook
   * XML response, not via a REST call. This method is intentionally a no-op
   * at the SDK level — emit the text via renderIvrResponse() in your webhook.
   *
   * @see src/lib/telephony/xml.ts — renderIvrResponse("FREJUN", { playText })
   */
  async playTts(callSid: string, text: string, language: string): Promise<void> {
    void callSid;
    void text;
    void language;
    // FreJun TTS is XML-level (<Speak> verb in webhook response), not REST-level.
    // Return silently; the webhook handler includes <Speak> in the XML response.
    console.warn(
      "[FreJun] playTts() is a no-op — TTS is delivered via <Speak> in the FreJun " +
        "XML webhook response. Use renderIvrResponse() in src/lib/telephony/xml.ts.",
    );
  }

  /**
   * Start recording the call via FreJun REST API.
   *
   * POST /calls/{call_id}/recording/start
   *
   * // FreJun assumption: response body on start is a 200 with no meaningful
   * //   recording ID returned (recording ID is the call_id itself).
   */
  async startRecording(callSid: string): Promise<{ recordingId: string }> {
    await this.frejunPost<Record<string, unknown>>(
      `/calls/${callSid}/recording/start`,
      {},
    );
    // FreJun assumption: recording is keyed by call_id; use it as the recordingId.
    return { recordingId: callSid };
  }

  /**
   * Stop recording the call via FreJun REST API.
   *
   * POST /calls/{call_id}/recording/stop
   *
   * // FreJun assumption: response contains { recording_url }.
   */
  async stopRecording(callSid: string): Promise<{ recordingUrl: string }> {
    const response = await this.frejunPost<{ recording_url: string }>(
      `/calls/${callSid}/recording/stop`,
      {},
    );
    return { recordingUrl: response.recording_url ?? "" };
  }

  /**
   * Verify the FreJun webhook signature.
   * FreJun signs the raw request body with HMAC-SHA256 using the webhook secret.
   * Header: X-Frejun-Signature (hex-encoded HMAC-SHA256).
   *
   * // FreJun assumption: signature is lowercase hex (same as Exotel's format).
   *
   * Uses `timingSafeEqual` to prevent timing-attack-based forgery.
   */
  verifyWebhookSignature(
    rawBody: string,
    signature: string | null,
    secret: string,
  ): boolean {
    if (!rawBody || !signature || !secret) return false;

    const expected = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex");

    try {
      return timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex"),
      );
    } catch {
      // Buffer.from(hex) throws if the hex string has an odd length or invalid chars
      return false;
    }
  }
}
