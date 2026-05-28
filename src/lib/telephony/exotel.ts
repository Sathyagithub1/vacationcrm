/**
 * src/lib/telephony/exotel.ts
 *
 * Exotel telephony adapter (Phase 6d).
 *
 * Exotel is a popular Indian cloud telephony provider used by travel agencies.
 * API docs: https://developer.exotel.com/
 *
 * v1 status:
 *   - verifyWebhookSignature: IMPLEMENTED (HMAC-SHA256, timing-safe compare)
 *   - All other methods: stubbed (throw NotImplementedError with tracking note)
 *     See TODO_BLOCKERS.md § 6D-B1 for live integration.
 *
 * Exotel webhook signature:
 *   Header: X-Exotel-Signature: <hex>
 *   HMAC-SHA256(rawBody, apiSecret)
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { TelephonyProvider } from "./types";
import { NotImplementedError } from "./types";

export class ExotelAdapter implements TelephonyProvider {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }> {
    void opts;
    throw new NotImplementedError(
      "Exotel",
      "placeCall",
      "TODO 6D-B1: call POST /v1/Accounts/{sid}/Calls/connect",
    );
  }

  async hangup(callSid: string): Promise<void> {
    void callSid;
    throw new NotImplementedError(
      "Exotel",
      "hangup",
      "TODO 6D-B1: call POST /v1/Accounts/{sid}/Calls/{CallSid}",
    );
  }

  async transferToAgent(callSid: string, agentNumber: string): Promise<void> {
    void callSid;
    void agentNumber;
    throw new NotImplementedError(
      "Exotel",
      "transferToAgent",
      "TODO 6D-B1: use Exotel conference bridge API",
    );
  }

  async playTts(callSid: string, text: string, language: string): Promise<void> {
    void callSid;
    void text;
    void language;
    throw new NotImplementedError(
      "Exotel",
      "playTts",
      "TODO 6D-B1: use Exotel Say action via ExoML",
    );
  }

  async startRecording(callSid: string): Promise<{ recordingId: string }> {
    void callSid;
    throw new NotImplementedError(
      "Exotel",
      "startRecording",
      "TODO 6D-B1: call POST /v1/Accounts/{sid}/Calls/{CallSid}/Recordings",
    );
  }

  async stopRecording(callSid: string): Promise<{ recordingUrl: string }> {
    void callSid;
    throw new NotImplementedError(
      "Exotel",
      "stopRecording",
      "TODO 6D-B1: call DELETE /v1/Accounts/{sid}/Calls/{CallSid}/Recordings/active",
    );
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
