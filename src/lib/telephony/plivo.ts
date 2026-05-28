/**
 * src/lib/telephony/plivo.ts
 *
 * Plivo telephony adapter (Phase 6d).
 *
 * Plivo is a global cloud communications platform supporting Indian numbers.
 * API docs: https://www.plivo.com/docs/
 *
 * v1 status:
 *   - verifyWebhookSignature: IMPLEMENTED (HMAC-SHA256, timing-safe compare)
 *   - All other methods: stubbed (throw NotImplementedError with tracking note)
 *     See TODO_BLOCKERS.md § 6D-B1 for live integration.
 *
 * Plivo webhook signature:
 *   Header: X-Plivo-Signature: <base64>
 *   HMAC-SHA256(url + sorted_params, authToken) → base64
 *   For JSON bodies: HMAC-SHA256(rawBody, authToken) → base64
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

export class PlivoAdapter implements TelephonyProvider {
  constructor(
    private readonly authId: string,
    private readonly authToken: string,
  ) {}

  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    void opts;
    throw new NotImplementedError(
      "Plivo",
      "placeCall",
      "TODO 6D-B1: call POST https://api.plivo.com/v1/Account/{auth_id}/Call/",
    );
  }

  async hangup(callSid: string): Promise<void> {
    void callSid;
    throw new NotImplementedError(
      "Plivo",
      "hangup",
      "TODO 6D-B1: call DELETE https://api.plivo.com/v1/Account/{auth_id}/Call/{call_uuid}/",
    );
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
