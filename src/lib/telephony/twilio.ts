/**
 * src/lib/telephony/twilio.ts
 *
 * Twilio telephony adapter (Phase 6d).
 *
 * Twilio is a widely-used global cloud communications platform.
 * API docs: https://www.twilio.com/docs/
 *
 * v1 status:
 *   - verifyWebhookSignature: IMPLEMENTED (HMAC-SHA256, timing-safe compare)
 *   - All other methods: stubbed (throw NotImplementedError with tracking note)
 *     See TODO_BLOCKERS.md § 6D-B1 for live integration.
 *
 * Twilio webhook signature:
 *   Header: X-Twilio-Signature: <base64>
 *   HMAC-SHA256(url + sorted_POST_params, authToken) → base64
 *   For JSON bodies: HMAC-SHA256(rawBody, authToken) → base64
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

export class TwilioAdapter implements TelephonyProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
  ) {}

  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    void opts;
    throw new NotImplementedError(
      "Twilio",
      "placeCall",
      "TODO 6D-B1: call POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls.json",
    );
  }

  async hangup(callSid: string): Promise<void> {
    void callSid;
    throw new NotImplementedError(
      "Twilio",
      "hangup",
      "TODO 6D-B1: call POST /Calls/{CallSid}.json with Status=completed",
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
