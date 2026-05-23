import { createHmac, timingSafeEqual } from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface SMSCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

interface TwilioSendResponse {
  sid?: string;
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
  message?: string;
}

export class SMSAdapter implements ChannelAdapter {
  readonly channel = "SMS";
  private credentials: SMSCredentials;

  constructor(credentials: SMSCredentials) {
    this.credentials = credentials;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      // Twilio delivers webhook fields as form-encoded key/value pairs
      const messageSid = body.MessageSid ?? body.SmsSid;
      const from = body.From;
      const messageBody = body.Body;

      if (!messageSid || !from || messageBody === undefined) return null;

      const messageSidStr = String(messageSid);
      const fromStr = String(from);
      const contentStr = String(messageBody);

      // Determine message type from NumMedia field
      const numMedia = parseInt(String(body.NumMedia ?? "0"), 10);
      let messageType = "TEXT";
      let fileUrl: string | undefined;

      if (numMedia > 0) {
        const mediaUrl = body.MediaUrl0;
        const mediaContentType = body.MediaContentType0;

        if (mediaUrl) {
          fileUrl = String(mediaUrl);
          const ct = String(mediaContentType ?? "");
          if (ct.startsWith("image/")) {
            messageType = "IMAGE";
          } else if (ct.startsWith("video/")) {
            messageType = "VIDEO";
          } else if (ct.startsWith("audio/")) {
            messageType = "AUDIO";
          } else {
            messageType = "DOCUMENT";
          }
        }
      }

      return {
        externalMessageId: messageSidStr,
        senderExternalId: fromStr,
        content: contentStr,
        messageType,
        fileUrl,
        channel: this.channel,
        rawPayload: body,
        timestamp: new Date(),
      };
    } catch (err) {
      console.error("[SMSAdapter] parseInbound error:", err);
      return null;
    }
  }

  async sendMessage(params: {
    externalId: string;
    content: string;
    messageType: string;
    fileUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SendResult> {
    const { externalId, content, fileUrl } = params;
    const { accountSid, authToken, fromNumber } = this.credentials;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const formData = new URLSearchParams();
    formData.set("To", externalId);
    formData.set("From", fromNumber);
    formData.set("Body", content);
    if (fileUrl) {
      formData.set("MediaUrl", fileUrl);
    }

    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: formData.toString(),
      });

      const data = (await res.json()) as TwilioSendResponse;

      if (!res.ok) {
        const errMsg = data.message ?? data.error_message ?? res.statusText;
        console.error("[SMSAdapter] sendMessage error:", res.status, data);
        return { success: false, error: errMsg ?? "Unknown error" };
      }

      if (data.error_code) {
        const errMsg = data.error_message ?? `Twilio error ${data.error_code}`;
        console.error("[SMSAdapter] Twilio delivery error:", data.error_code, errMsg);
        return { success: false, error: errMsg };
      }

      console.log("[SMSAdapter] Sent to", externalId, "SID:", data.sid);
      return { success: true, externalMessageId: data.sid };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[SMSAdapter] sendMessage fetch error:", err);
      return { success: false, error: message };
    }
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    // Twilio signature verification:
    // https://www.twilio.com/docs/usage/webhooks/webhooks-security
    // X-Twilio-Signature is HMAC-SHA1 of (URL + sorted POST params) signed with authToken

    const twilioSignature =
      headers["x-twilio-signature"] ?? headers["X-Twilio-Signature"];
    if (!twilioSignature) return false;

    // The full webhook URL must be reconstructed by the caller and passed as body
    // Convention: pass "url\nkey=value&..." as body where first line is the URL
    // However, since our interface passes raw body string, we use a simplified approach:
    // Callers must pass the concatenated url+sorted params string as `body`.
    const expected = createHmac("sha1", this.credentials.authToken)
      .update(body, "utf8")
      .digest("base64");

    try {
      return timingSafeEqual(Buffer.from(twilioSignature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
