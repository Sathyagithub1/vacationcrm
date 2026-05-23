import { createHmac, timingSafeEqual } from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface InstagramCredentials {
  appSecret: string;
  pageAccessToken: string;
  pageId: string;
}

interface IGAttachment {
  type: string;
  payload?: { url?: string };
}

interface IGMessage {
  mid: string;
  text?: string;
  attachments?: IGAttachment[];
  reply_to?: { story?: { url?: string; id?: string }; mid?: string };
}

interface IGSender {
  id: string;
}

interface IGMessagingEvent {
  sender?: IGSender;
  timestamp?: number;
  message?: IGMessage;
  postback?: { title: string; payload: string };
}

interface IGEntry {
  messaging?: IGMessagingEvent[];
}

function resolveIGAttachment(attachments: IGAttachment[]): { messageType: string; content: string; fileUrl?: string } {
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
    case "story_mention":
      return { messageType: "STORY_MENTION", content: "", fileUrl: url };
    case "share":
      return { messageType: "SHARE", content: "", fileUrl: url };
    case "reel":
      return { messageType: "VIDEO", content: "", fileUrl: url };
    default:
      return { messageType: first.type.toUpperCase(), content: "", fileUrl: url };
  }
}

export class InstagramAdapter implements ChannelAdapter {
  readonly channel = "INSTAGRAM";
  private credentials: InstagramCredentials;

  constructor(credentials: InstagramCredentials) {
    this.credentials = credentials;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      if (body.object !== "instagram") return null;

      const entries = body.entry as IGEntry[] | undefined;
      const messaging = entries?.[0]?.messaging?.[0];

      if (!messaging?.message) return null;

      const senderId = messaging.sender?.id;
      if (!senderId) return null;

      const message = messaging.message;

      let content = "";
      let messageType = "TEXT";
      let fileUrl: string | undefined;

      // Check for story reply
      if (message.reply_to?.story) {
        content = message.text ?? "";
        messageType = "STORY_REPLY";
        fileUrl = message.reply_to.story.url;
      } else if (message.attachments && message.attachments.length > 0) {
        const resolved = resolveIGAttachment(message.attachments);
        content = resolved.content;
        messageType = resolved.messageType;
        fileUrl = resolved.fileUrl;
      } else if (message.text) {
        content = message.text;
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
      console.error("[InstagramAdapter] parseInbound error:", err);
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
    const url = `https://graph.facebook.com/v19.0/${this.credentials.pageId}/messages`;

    let messagePayload: Record<string, unknown>;

    if ((messageType === "IMAGE" || messageType === "VIDEO" || messageType === "AUDIO") && fileUrl) {
      const attachmentType = messageType.toLowerCase();
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
        console.error("[InstagramAdapter] sendMessage error:", res.status, data);
        return { success: false, error: errMsg };
      }

      const externalMessageId = typeof data.message_id === "string" ? data.message_id : undefined;
      return { success: true, externalMessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[InstagramAdapter] sendMessage fetch error:", err);
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
