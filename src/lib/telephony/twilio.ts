/**
 * src/lib/telephony/twilio.ts
 *
 * Twilio telephony adapter (Phase 6d / 6h).
 *
 * Twilio is a widely-used global cloud communications platform.
 * API docs: https://www.twilio.com/docs/voice/api/call-resource
 *
 * Credential shape (per src/lib/telephony/types.ts + index.ts factory):
 *   telephonyApiKey    → Account SID   (constructor arg `accountSid`)
 *   telephonyApiSecret → Auth Token    (constructor arg `authToken`)
 *   Both are decrypted by getTelephonyProvider() before construction.
 *
 * Authentication:
 *   HTTP Basic auth — username = AccountSid, password = AuthToken.
 *   The AccountSid also appears in the URL path.
 *
 * REST base:
 *   https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/
 *
 * Call-control vs TwiML:
 *   - placeCall / hangup are implemented via the REST Call resource.
 *   - transferToAgent / playTts / startRecording / stopRecording remain
 *     TwiML-level concerns (<Dial>/<Say>) handled by the IVR webhook XML
 *     response — see src/lib/telephony/xml.ts. Not touched here.
 *
 * v1 status:
 *   - placeCall / hangup: IMPLEMENTED (REST, Basic auth)
 *   - verifyWebhookSignature: IMPLEMENTED (HMAC-SHA256, timing-safe compare)
 *   - transfer/tts/recording: stubbed (TwiML) — see TODO_BLOCKERS.md § 6D-B1.
 *
 * Twilio webhook signature:
 *   Header: X-Twilio-Signature: <base64>
 *   HMAC-SHA256(url + sorted_POST_params, authToken) → base64
 *   For JSON bodies: HMAC-SHA256(rawBody, authToken) → base64
 *
 * Secrets are NEVER logged.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export class TwilioAdapter implements TelephonyProvider {
  /**
   * @param accountSid Twilio Account SID (telephonyApiKey). Also the Basic-auth username.
   * @param authToken  Twilio Auth Token (telephonyApiSecret). Basic-auth password. NEVER logged.
   */
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
  ) {}

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Ensure both credentials are present before making a REST call so callers
   * surface a clear error rather than a confusing 401 from Twilio.
   */
  private assertCredentials(): void {
    if (!this.accountSid || !this.authToken) {
      throw new Error(
        "[Twilio] Missing credentials: accountSid (telephonyApiKey) and " +
          "authToken (telephonyApiSecret) are both required.",
      );
    }
  }

  /**
   * Build the Basic auth header value for Twilio REST calls.
   * Format: Base64("AccountSid:AuthToken"). Never logged.
   */
  private basicAuth(): string {
    return Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
  }

  /**
   * Make an authenticated form-encoded POST to the Twilio API.
   * `path` is relative to the account base (e.g. "/Calls.json").
   * Returns the parsed JSON response. Throws on HTTP 4xx/5xx.
   */
  private async twilioPost<T>(
    path: string,
    formParams: Record<string, string>,
  ): Promise<T> {
    const url = `${TWILIO_API_BASE}/Accounts/${this.accountSid}${path}`;
    const body = new URLSearchParams(formParams).toString();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const text = await res.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`[Twilio] Non-JSON response (${res.status}): ${text}`);
    }

    if (!res.ok) {
      // Twilio error shape: { code, message, more_info, status }
      const err = parsed as { message?: string; code?: number };
      const msg = err?.message ?? text;
      throw new Error(`[Twilio] API error ${res.status}: ${msg}`);
    }

    return parsed;
  }

  // ── TelephonyProvider interface ─────────────────────────────────────────────

  /**
   * Initiate an outbound call via the Twilio REST Call resource.
   *
   * POST /2010-04-01/Accounts/{AccountSid}/Calls.json
   * Body (form-urlencoded): From, To, Url
   *   Url is the TwiML webhook Twilio fetches once the call connects.
   *
   * Returns the Twilio Call SID from the response `sid` field.
   */
  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    this.assertCredentials();

    const response = await this.twilioPost<{ sid: string }>("/Calls.json", {
      From: opts.from,
      To: opts.to,
      Url: opts.webhookUrl,
    });

    return { callSid: response.sid };
  }

  /**
   * Hang up an in-progress call via the Twilio REST Call resource.
   *
   * POST /2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}.json
   * Body (form-urlencoded): Status=completed
   *
   * Twilio uses POST (not DELETE) to mutate a call into the terminal
   * "completed" state.
   */
  async hangup(callSid: string): Promise<void> {
    this.assertCredentials();

    await this.twilioPost<{ sid: string; status: string }>(
      `/Calls/${encodeURIComponent(callSid)}.json`,
      { Status: "completed" },
    );
  }

  async transferToAgent(callSid: string, agentNumber: string): Promise<void> {
    void callSid;
    void agentNumber;
    throw new NotImplementedError(
      "Twilio",
      "transferToAgent",
      "TODO 6D-B1: use Twilio <Dial> TwiML verb",
    );
  }

  async playTts(callSid: string, text: string, language: string): Promise<void> {
    void callSid;
    void text;
    void language;
    throw new NotImplementedError(
      "Twilio",
      "playTts",
      "TODO 6D-B1: use Twilio <Say> TwiML verb",
    );
  }

  async startRecording(callSid: string): Promise<{ recordingId: string }> {
    void callSid;
    throw new NotImplementedError(
      "Twilio",
      "startRecording",
      "TODO 6D-B1: call POST /Calls/{CallSid}/Recordings.json",
    );
  }

  async stopRecording(callSid: string): Promise<{ recordingUrl: string }> {
    void callSid;
    throw new NotImplementedError(
      "Twilio",
      "stopRecording",
      "TODO 6D-B1: PATCH Recording to completed, retrieve media URL",
    );
  }

  /**
   * Verify a Twilio webhook signature.
   * Twilio signs JSON payloads with HMAC-SHA256(rawBody, authToken) → base64.
   *
   * Uses `timingSafeEqual` to prevent timing attacks.
   */
  verifyWebhookSignature(
    rawBody: string,
    signature: string | null,
    secret: string,
  ): boolean {
    if (!rawBody || !signature || !secret) return false;

    const expected = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    try {
      return timingSafeEqual(
        Buffer.from(signature, "base64"),
        Buffer.from(expected, "base64"),
      );
    } catch {
      return false;
    }
  }
}
