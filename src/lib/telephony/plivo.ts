/**
 * src/lib/telephony/plivo.ts
 *
 * Plivo telephony adapter (Phase 6d / 6h).
 *
 * Plivo is a global cloud communications platform supporting Indian numbers.
 * API docs: https://www.plivo.com/docs/
 *
 * Authentication:
 *   HTTP Basic auth — username = Auth ID, password = Auth Token.
 *   The Auth ID also appears in the URL path (/v1/Account/{AUTH_ID}/).
 *
 * Tenant credential shape (per src/lib/telephony/types.ts):
 *   telephonyApiKey    → Auth ID   (public identifier) → constructor `authId`
 *   telephonyApiSecret → Auth Token (encrypted secret) → constructor `authToken`
 *   The factory (index.ts) decrypts both and passes them positionally, so the
 *   constructor signature is unchanged from the original stub.
 *
 * v1 status:
 *   - placeCall / hangup: IMPLEMENTED via Plivo REST API v1.
 *   - verifyWebhookSignature: IMPLEMENTED (HMAC-SHA256, timing-safe compare).
 *   - transferToAgent / playTts / startRecording / stopRecording: still stubbed.
 *
 * Call-control vs XML:
 *   - transferToAgent / playTts are PHLO/Plivo XML (PXML) concerns handled via
 *     the IVR webhook response (see src/lib/telephony/xml.ts), not REST.
 *
 * Plivo webhook signature:
 *   Header: X-Plivo-Signature: <base64>
 *   HMAC-SHA256(url + sorted_params, authToken) → base64
 *   For JSON bodies: HMAC-SHA256(rawBody, authToken) → base64
 *
 * SECURITY: never log authId/authToken or the Basic auth header.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

export class PlivoAdapter implements TelephonyProvider {
  constructor(
    private readonly authId: string,
    private readonly authToken: string,
  ) {}

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Validate that Auth ID and Auth Token are present.
   * Throws a clear, non-secret-leaking error if either is missing.
   */
  private assertCredentials(): void {
    if (!this.authId || !this.authToken) {
      throw new Error(
        "[Plivo] Missing credentials — telephonyApiKey (Auth ID) and " +
          "telephonyApiSecret (Auth Token) must both be set.",
      );
    }
  }

  /**
   * Build the Basic auth header value for Plivo REST API calls.
   * Format: Base64("authId:authToken"). Never logged.
   */
  private basicAuth(): string {
    return Buffer.from(`${this.authId}:${this.authToken}`).toString("base64");
  }

  /** Base URL for this account's REST resources. */
  private accountUrl(path: string): string {
    return `https://api.plivo.com/v1/Account/${this.authId}${path}`;
  }

  /**
   * Make an authenticated JSON POST to the Plivo API.
   * Returns the parsed JSON response. Throws on HTTP 4xx/5xx.
   */
  private async plivoPost<T>(
    path: string,
    body: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(this.accountUrl(path), {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.basicAuth()}`,
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
      throw new Error(`[Plivo] Non-JSON response (${res.status}): ${text}`);
    }

    if (!res.ok) {
      const err = parsed as { error?: string; message?: string };
      const msg = err?.error ?? err?.message ?? text;
      throw new Error(`[Plivo] API error ${res.status}: ${msg}`);
    }

    return parsed;
  }

  /**
   * Make an authenticated DELETE to the Plivo API. Throws on HTTP 4xx/5xx.
   * Plivo returns 204 No Content on a successful call hangup.
   */
  private async plivoDelete(path: string): Promise<void> {
    const res = await fetch(this.accountUrl(path), {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${this.basicAuth()}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[Plivo] DELETE ${path} failed ${res.status}: ${text}`);
    }
  }

  // ── TelephonyProvider interface ─────────────────────────────────────────────

  /**
   * Initiate an outbound call via Plivo REST API.
   *
   * POST /v1/Account/{authId}/Call/
   * Body (JSON): from, to, answer_url
   *
   * Plivo responds (HTTP 201) with { message, request_uuid, api_id }. The
   * request_uuid is the handle used to control the call (e.g. hangup), so it is
   * normalized to `callSid` to match the TelephonyProvider contract.
   */
  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    this.assertCredentials();

    const response = await this.plivoPost<{ request_uuid: string }>("/Call/", {
      from: opts.from,
      to: opts.to,
      answer_url: opts.webhookUrl,
    });

    if (!response.request_uuid) {
      throw new Error("[Plivo] placeCall response missing request_uuid.");
    }

    return { callSid: response.request_uuid };
  }

  /**
   * Hang up a call via Plivo REST API.
   *
   * DELETE /v1/Account/{authId}/Call/{callUuid}/
   *
   * `callSid` here is the Plivo Call UUID (or the request_uuid returned by
   * placeCall). Plivo returns 204 No Content on success.
   */
  async hangup(callSid: string): Promise<void> {
    this.assertCredentials();
    if (!callSid) {
      throw new Error("[Plivo] hangup requires a call UUID.");
    }
    await this.plivoDelete(`/Call/${callSid}/`);
  }

  async transferToAgent(callSid: string, agentNumber: string): Promise<void> {
    void callSid;
    void agentNumber;
    throw new NotImplementedError(
      "Plivo",
      "transferToAgent",
      "TODO 6D-B1: use Plivo Transfer action in PHML",
    );
  }

  async playTts(callSid: string, text: string, language: string): Promise<void> {
    void callSid;
    void text;
    void language;
    throw new NotImplementedError(
      "Plivo",
      "playTts",
      "TODO 6D-B1: use Plivo Speak action via PHML",
    );
  }

  async startRecording(callSid: string): Promise<{ recordingId: string }> {
    void callSid;
    throw new NotImplementedError(
      "Plivo",
      "startRecording",
      "TODO 6D-B1: call POST https://api.plivo.com/v1/Account/{auth_id}/Call/{call_uuid}/Record/",
    );
  }

  async stopRecording(callSid: string): Promise<{ recordingUrl: string }> {
    void callSid;
    throw new NotImplementedError(
      "Plivo",
      "stopRecording",
      "TODO 6D-B1: call DELETE https://api.plivo.com/v1/Account/{auth_id}/Call/{call_uuid}/Record/",
    );
  }

  /**
   * Verify a Plivo webhook signature.
   * Plivo signs JSON payloads with HMAC-SHA256(rawBody, authToken) → base64.
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
