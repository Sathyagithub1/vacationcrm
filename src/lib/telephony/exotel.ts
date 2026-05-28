/**
 * src/lib/telephony/exotel.ts
 *
 * Exotel telephony adapter (Phase 6f).
 *
 * Exotel is a popular Indian cloud telephony provider used by travel agencies.
 * API docs: https://developer.exotel.com/
 *
 * Authentication:
 *   HTTP Basic auth — username = apiKey, password = apiToken.
 *   The accountSid appears in the URL path.
 *
 * Tenant credential shape (telephonyApiKey field stores JSON):
 *   telephonyApiKey: encrypted JSON string `{ "accountSid": "...", "apiKey": "...", "apiToken": "..." }`
 *   telephonyApiSecret: legacy / unused for Exotel (kept for interface compat)
 *
 * Call-control vs XML:
 *   - placeCall / hangup are implemented via REST (Exotel API v1).
 *   - transferToAgent: Exotel has no REST-level mid-call transfer. The correct
 *     approach is to use the <Dial> ExoML verb in the IVR webhook XML response.
 *     This method documents that limitation and throws NotImplementedError pointing
 *     to the IVR XML approach (see src/lib/telephony/xml.ts).
 *   - playTts / startRecording / stopRecording: these are ExoML (XML) concerns,
 *     not REST concerns. They are documented and are no-ops at the SDK level —
 *     actual TTS/recording is controlled by the IVR webhook XML response.
 *
 * verifyWebhookSignature:
 *   Header: X-Exotel-Signature: <hex>
 *   HMAC-SHA256(rawBody, apiSecret) — already correct, not touched.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Shape of the JSON stored in `telephonyApiKey` for Exotel tenants.
 * Decrypt the field via `decryptIfEncrypted` before parsing.
 */
export interface ExotelCredentials {
  accountSid: string;
  apiKey: string;
  apiToken: string;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ExotelAdapter implements TelephonyProvider {
  /**
   * @param apiKey    For Exotel this is used as the webhook-signature secret
   *                  (kept for interface compat with getTelephonyProvider).
   *                  Pass a JSON string `{ accountSid, apiKey, apiToken }` when
   *                  constructing directly for REST calls.
   * @param apiSecret Used as the HMAC secret in verifyWebhookSignature.
   */
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Try to parse apiKey as ExotelCredentials JSON.
   * Throws a clear error if the format is wrong so callers surface it early.
   */
  private parseCredentials(): ExotelCredentials {
    let creds: ExotelCredentials;
    try {
      creds = JSON.parse(this.apiKey) as ExotelCredentials;
    } catch {
      throw new Error(
        "[Exotel] telephonyApiKey must be a JSON string with shape " +
          '{ accountSid, apiKey, apiToken }. Got non-JSON value.',
      );
    }
    if (!creds.accountSid || !creds.apiKey || !creds.apiToken) {
      throw new Error(
        "[Exotel] telephonyApiKey JSON must contain accountSid, apiKey, and apiToken.",
      );
    }
    return creds;
  }

  /**
   * Build the Basic auth header value for Exotel REST API calls.
   * Format: Base64("apiKey:apiToken")
   */
  private basicAuth(apiKey: string, apiToken: string): string {
    return Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  }

  /**
   * Make an authenticated form-encoded POST to the Exotel API.
   * Returns the parsed JSON response.
   * Throws on HTTP 4xx/5xx.
   */
  private async exotelPost<T>(
    accountSid: string,
    apiKey: string,
    apiToken: string,
    path: string,
    formParams: Record<string, string>,
  ): Promise<T> {
    const url = `https://api.exotel.com/v1/Accounts/${accountSid}${path}`;
    const body = new URLSearchParams(formParams).toString();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.basicAuth(apiKey, apiToken)}`,
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
      throw new Error(`[Exotel] Non-JSON response (${res.status}): ${text}`);
    }

    if (!res.ok) {
      const err = parsed as { RestException?: { Message?: string } };
      const msg = err?.RestException?.Message ?? text;
      throw new Error(`[Exotel] API error ${res.status}: ${msg}`);
    }

    return parsed;
  }

  /**
   * Make an authenticated DELETE to the Exotel API.
   * Throws on HTTP 4xx/5xx.
   */
  private async exotelDelete(
    accountSid: string,
    apiKey: string,
    apiToken: string,
    path: string,
  ): Promise<void> {
    const url = `https://api.exotel.com/v1/Accounts/${accountSid}${path}`;

    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${this.basicAuth(apiKey, apiToken)}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[Exotel] DELETE ${path} failed ${res.status}: ${text}`);
    }
  }

  // ── TelephonyProvider interface ─────────────────────────────────────────────

  /**
   * Initiate an outbound call via Exotel REST API.
   *
   * POST /v1/Accounts/{accountSid}/Calls/connect.json
   * Body (form-urlencoded): From, To, CallerId, Url
   *
   * Returns the Exotel Call SID from the response.
   */
  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    const { accountSid, apiKey, apiToken } = this.parseCredentials();

    const response = await this.exotelPost<{ Call: { Sid: string } }>(
      accountSid,
      apiKey,
      apiToken,
      "/Calls/connect.json",
      {
        From: opts.from,
        To: opts.to,
        CallerId: opts.from,
        Url: opts.webhookUrl,
      },
    );

    return { callSid: response.Call.Sid };
  }

  /**
   * Hang up a call via Exotel REST API.
   *
   * DELETE /v1/Accounts/{accountSid}/Calls/{callSid}.json
   */
  async hangup(callSid: string): Promise<void> {
    const { accountSid, apiKey, apiToken } = this.parseCredentials();
    await this.exotelDelete(accountSid, apiKey, apiToken, `/Calls/${callSid}.json`);
  }

  /**
   * Transfer the active call to a human agent.
   *
   * NOTE: Exotel does not support REST-level mid-call transfer.
   * The correct approach is to return a <Dial> verb in the IVR webhook
   * XML response (ExoML). Use `renderIvrResponse("EXOTEL", { transferTo })` from
   * `src/lib/telephony/xml.ts` in your webhook handler to achieve this.
   *
   * @throws NotImplementedError — pointing to the IVR XML response approach.
   */
  async transferToAgent(callSid: string, agentNumber: string): Promise<void> {
    void callSid;
    void agentNumber;
    throw new NotImplementedError(
      "Exotel",
      "transferToAgent",
      "Exotel has no REST mid-call transfer. " +
        "Use <Dial> in the ExoML webhook response instead — " +
        "see renderIvrResponse() in src/lib/telephony/xml.ts.",
    );
  }

  /**
   * Play TTS mid-call.
   *
   * NOTE: Exotel renders TTS via the <Say> ExoML verb in the IVR webhook
   * XML response, not via a REST call. This method is intentionally a no-op
   * at the SDK level — emit the text via renderIvrResponse() in your webhook.
   *
   * @see src/lib/telephony/xml.ts — renderIvrResponse("EXOTEL", { playText })
   */
  async playTts(callSid: string, text: string, language: string): Promise<void> {
    void callSid;
    void text;
    void language;
    // Exotel TTS is XML-level (<Say> ExoML verb), not REST-level.
    // Return silently; the webhook handler will include <Say> in the XML response.
    console.warn(
      "[Exotel] playTts() is a no-op — TTS is delivered via <Say> in the ExoML " +
        "webhook response. Use renderIvrResponse() in src/lib/telephony/xml.ts.",
    );
  }

  /**
   * Start recording the call.
   *
   * NOTE: Exotel recording is enabled via the `record="true"` attribute on the
   * <Dial> verb in the ExoML XML response, not via a REST call.
   *
   * @see src/lib/telephony/xml.ts — renderIvrResponse("EXOTEL", { ... })
   */
  async startRecording(callSid: string): Promise<{ recordingId: string }> {
    void callSid;
    // Exotel recording is XML-level (record="true" on <Dial>), not REST-level.
    console.warn(
      "[Exotel] startRecording() is a no-op — recording is controlled via " +
        "record=\"true\" on the <Dial> ExoML verb in the webhook response.",
    );
    return { recordingId: "exotel-xml-recording" };
  }

  /**
   * Stop recording the call.
   *
   * NOTE: Same as startRecording — Exotel recording lifecycle is managed by
   * the ExoML XML response, not by REST calls.
   */
  async stopRecording(callSid: string): Promise<{ recordingUrl: string }> {
    void callSid;
    // Exotel recording stop is XML-level; the URL comes in the call-completed webhook.
    console.warn(
      "[Exotel] stopRecording() is a no-op — recording URL is delivered in the " +
        "call-completed webhook payload (RecordingUrl field).",
    );
    return { recordingUrl: "" };
  }

  /**
   * Verify the Exotel webhook signature.
   * Exotel signs the raw request body with HMAC-SHA256 using the API secret.
   * Header: X-Exotel-Signature
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
      return false;
    }
  }
}
