import { createHmac, timingSafeEqual } from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface FacebookCredentials {
  appSecret: string;
  pageAccessToken: string;
  pageId?: string;
}

interface FBMessageAttachment {
  type: string;
  payload?: {
    url?: string;
    sticker_id?: number;
    coordinates?: { lat: number; long: number };
  };
}

interface FBMessage {
  mid: string;
  text?: string;
  attachments?: FBMessageAttachment[];
  quick_reply?: { payload: string };
  reply_to?: { mid: string };
  sticker_id?: number;
  postback?: { title: string; payload: string };
}

interface FBSender {
  id: string;
}

interface FBRecipient {
  id: string;
}

interface FBMessagingEvent {
  sender?: FBSender;
  recipient?: FBRecipient;
  timestamp?: number;
  message?: FBMessage;
  postback?: { title: string; payload: string };
}

interface FBEntry {
  messaging?: FBMessagingEvent[];
}

function resolveAttachment(attachments: FBMessageAttachment[]): { messageType: string; content: string; fileUrl?: string } {
  const first = attachments[0];
  if (!first) return { messageType: "TEXT", content: "" };

  const url = first.payload?.url;

  switch (first.type) {
    case "image":
      return { messageType: "IMAGE", content: "", fileUrl: url };
    case "video":
      return { messageType: "VIDEO", content: "", fileUrl: url };
    case "audio":
      return { messageType: "AUDIO", content: "", fileUrl: url };
    case "file":
      return { messageType: "DOCUMENT", content: "", fileUrl: url };
    case "location": {
      const coords = first.payload?.coordinates;
      return {
        messageType: "LOCATION",
        content: coords ? `${coords.lat},${coords.long}` : "",
      };
    }
    case "sticker":
      return { messageType: "STICKER", content: "", fileUrl: url };
    case "fallback":
      return { messageType: "TEXT", content: url ?? "" };
    default:
      return { messageType: first.type.toUpperCase(), content: "", fileUrl: url };
  }
}

export class FacebookAdapter implements ChannelAdapter {
  readonly channel = "FACEBOOK";
  private credentials: FacebookCredentials;

  constructor(credentials: FacebookCredentials) {
    this.credentials = credentials;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      if (body.object !== "page") return null;

      const entries = body.entry as FBEntry[] | undefined;
      const messaging = entries?.[0]?.messaging?.[0];

      if (!messaging?.message) return null;

      const senderId = messaging.sender?.id;
      if (!senderId) return null;

      const message = messaging.message;

      let content = "";
      let messageType = "TEXT";
      let fileUrl: string | undefined;

      if (message.postback) {
        content = message.postback.title;
        messageType = "POSTBACK";
      } else if (message.attachments && message.attachments.length > 0) {
        const resolved = resolveAttachment(message.attachments);
        content = resolved.content;
        messageType = resolved.messageType;
        fileUrl = resolved.fileUrl;
      } else if (message.quick_reply) {
        content = message.quick_reply.payload;
        messageType = "QUICK_REPLY";
      } else {
        content = message.text ?? "";
        messageType = "TEXT";
      }

      return {
        externalMessageId: message.mid,
        senderExternalId: senderId,
        content,
        messageType,
        fileUrl,
        channel: this.channel,
        rawPayload: body,
        timestamp: messaging.timestamp ? new Date(messaging.timestamp) : new Date(),
      };
    } catch (err) {
      console.error("[FacebookAdapter] parseInbound error:", err);
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
    const { externalId, content, messageType, fileUrl } = params;
    const url = "https://graph.facebook.com/v19.0/me/messages";

    let messagePayload: Record<string, unknown>;

    if ((messageType === "IMAGE" || messageType === "VIDEO" || messageType === "AUDIO" || messageType === "DOCUMENT") && fileUrl) {
      const attachmentType = messageType === "DOCUMENT" ? "file" : messageType.toLowerCase();
      messagePayload = {
        attachment: {
          type: attachmentType,
          payload: { url: fileUrl, is_reusable: true },
        },
      };
    } else {
      messagePayload = { text: content };
    }

    try {
      const res = await fetch(`${url}?access_token=${this.credentials.pageAccessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: externalId },
          message: messagePayload,
          messaging_type: "RESPONSE",
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const errObj = data.error as Record<string, unknown> | undefined;
        const errMsg = typeof errObj?.message === "string" ? errObj.message : res.statusText;
        console.error("[FacebookAdapter] sendMessage error:", res.status, data);
        return { success: false, error: errMsg };
      }

      const externalMessageId = typeof data.message_id === "string" ? data.message_id : undefined;
      return { success: true, externalMessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FacebookAdapter] sendMessage fetch error:", err);
      return { success: false, error: message };
    }
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    const expected = `sha256=${createHmac("sha256", this.credentials.appSecret)
      .update(body, "utf8")
      .digest("hex")}`;

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
