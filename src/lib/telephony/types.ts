/**
 * src/lib/telephony/types.ts
 *
 * Telephony provider interface (Phase 6d).
 *
 * All telephony adapters (Exotel, Plivo, Twilio) implement this interface so
 * that the rest of the application is decoupled from provider specifics.
 *
 * Signature verification:
 *   Every provider must implement `verifyWebhookSignature` using
 *   HMAC-SHA256 + `crypto.timingSafeEqual` to guard against timing attacks.
 *
 * Not-implemented stubs:
 *   Methods that require live API access throw `NotImplementedError` in v1.
 *   See TODO_BLOCKERS.md § 6D-B1 for the integration migration path.
 */

export interface TelephonyProvider {
  /**
   * Initiate an outbound call from `from` to `to`.
   * Returns the provider's call identifier (callSid/CallUUID/etc.).
   */
  placeCall(opts: {
    from: string;
    to: string;
    webhookUrl: string;
  }): Promise<{ callSid: string }>;

  /**
   * Hang up an in-progress call identified by `callSid`.
   */
  hangup(callSid: string): Promise<void>;

  /**
   * Bridge a call to a human agent number (warm transfer).
   */
  transferToAgent(callSid: string, agentNumber: string): Promise<void>;

  /**
   * Play synthesised text to the caller mid-call.
   * `language` is a BCP-47 tag (e.g. "en-IN", "hi-IN").
   */
  playTts(callSid: string, text: string, language: string): Promise<void>;

  /**
   * Start recording the call.
   * Returns the provider's recording identifier.
   */
  startRecording(callSid: string): Promise<{ recordingId: string }>;

  /**
   * Stop recording and return the URL to the recording file.
   */
  stopRecording(callSid: string): Promise<{ recordingUrl: string }>;

  /**
   * Verify the HMAC-SHA256 webhook signature sent by the provider.
   *
   * @param rawBody   Raw UTF-8 request body string (before JSON.parse).
   * @param signature Value from the provider-specific signature header
   *                  (or null if the header was absent).
   * @param secret    Tenant's webhook secret for this provider.
   * @returns         true if the signature is valid, false otherwise.
   */
  verifyWebhookSignature(
    rawBody: string,
    signature: string | null,
    secret: string,
  ): boolean;
}

// ── Per-provider credential shapes ───────────────────────────────────────────
//
// All providers store credentials in the `Tenant.telephonyApiKey` DB field as
// an AES-256-GCM encrypted JSON string (via credential-encryption.ts).
// Use `decryptIfEncrypted(tenant.telephonyApiKey)` then `JSON.parse()` to read.
//
// EXOTEL
//   telephonyApiKey  → encrypted JSON { accountSid: string, apiKey: string, apiToken: string }
//   telephonyApiSecret → encrypted HMAC webhook secret (X-Exotel-Signature)
//
// PLIVO
//   telephonyApiKey  → Auth ID (plain string — public identifier)
//   telephonyApiSecret → encrypted Auth Token
//
// TWILIO
//   telephonyApiKey  → Account SID (plain string — public identifier)
//   telephonyApiSecret → encrypted Auth Token
//
// FREJUN
//   telephonyApiKey  → encrypted JSON
//     { apiToken: string, callerNumber?: string, webhookSecret: string }
//     (All three fields in one JSON blob since FreJun has a single credential type)
//   telephonyApiSecret → set to any non-empty placeholder ("-") to satisfy the
//     credential-completeness guard; actual secret lives in the apiKey JSON above.
//

/**
 * Thrown by stub adapter methods that have not yet been wired to the live API.
 * The `trackingNote` is logged so engineers can easily grep for stubs.
 */
export class NotImplementedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly method: string,
    public readonly trackingNote: string,
  ) {
    super(
      `[${provider}] ${method} is not yet implemented. ${trackingNote}`,
    );
    this.name = "NotImplementedError";
  }
}
