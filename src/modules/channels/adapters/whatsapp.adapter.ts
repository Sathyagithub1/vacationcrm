import { createHmac, timingSafeEqual } from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface WhatsAppCredentials {
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  verifyToken?: string;
}

interface WAMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type: string; sha256: string };
  document?: { id: string; caption?: string; filename: string; mime_type: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; caption?: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string } };
}

interface WAContact {
  profile?: { name?: string };
  wa_id?: string;
}

interface WAValue {
  messages?: WAMessage[];
  contacts?: WAContact[];
}

interface WAChange {
  value?: WAValue;
}

interface WAEntry {
  changes?: WAChange[];
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = "WHATSAPP";
  private credentials: WhatsAppCredentials;

  constructor(credentials: WhatsAppCredentials) {
    this.credentials = credentials;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      const entry = (body.entry as WAEntry[] | undefined)?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) return null;

      const contact = value?.contacts?.[0];
      const senderName = contact?.profile?.name;

      let content = "";
      let messageType = "TEXT";
      let fileUrl: string | undefined;

      switch (message.type) {
        case "text":
          content = message.text?.body ?? "";
          messageType = "TEXT";
          break;
        case "image":
          content = message.image?.caption ?? "";
          messageType = "IMAGE";
          fileUrl = message.image ? `wa-media:${message.image.id}` : undefined;
          break;
        case "document":
          content = message.document?.caption ?? message.document?.filename ?? "";
          messageType = "DOCUMENT";
          fileUrl = message.document ? `wa-media:${message.document.id}` : undefined;
          break;
        case "audio":
          content = "";
          messageType = "AUDIO";
          fileUrl = message.audio ? `wa-media:${message.audio.id}` : undefined;
          break;
        case "video":
          content = message.video?.caption ?? "";
          messageType = "VIDEO";
          fileUrl = message.video ? `wa-media:${message.video.id}` : undefined;
          break;
        case "sticker":
          content = "";
          messageType = "STICKER";
          fileUrl = message.sticker ? `wa-media:${message.sticker.id}` : undefined;
          break;
        case "location":
          content = message.location
            ? `${message.location.name ?? "Location"}: ${message.location.latitude},${message.location.longitude}`
            : "";
          messageType = "LOCATION";
          break;
        case "interactive":
          content =
            message.interactive?.button_reply?.title ??
            message.interactive?.list_reply?.title ??
            "";
          messageType = "INTERACTIVE";
          break;
        default:
          content = "";
          messageType = message.type.toUpperCase();
      }

      return {
        externalMessageId: message.id,
        senderExternalId: message.from,
        senderName,
        content,
        messageType,
        fileUrl,
        channel: this.channel,
        rawPayload: body,
        timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
      };
    } catch (err) {
      console.error("[WhatsAppAdapter] parseInbound error:", err);
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
    const url = `https://graph.facebook.com/v19.0/${this.credentials.phoneNumberId}/messages`;

    let messagePayload: Record<string, unknown>;

    if (messageType === "IMAGE" && fileUrl) {
      messagePayload = {
        type: "image",
        image: { link: fileUrl, caption: content },
      };
    } else if (messageType === "DOCUMENT" && fileUrl) {
      messagePayload = {
        type: "document",
        document: { link: fileUrl, caption: content },
      };
    } else if (messageType === "AUDIO" && fileUrl) {
      messagePayload = {
        type: "audio",
        audio: { link: fileUrl },
      };
    } else if (messageType === "VIDEO" && fileUrl) {
      messagePayload = {
        type: "video",
        video: { link: fileUrl, caption: content },
      };
    } else {
      messagePayload = {
        type: "text",
        text: { body: content, preview_url: false },
      };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.credentials.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: externalId,
          ...messagePayload,
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const errObj = data.error as Record<string, unknown> | undefined;
        const errMsg = typeof errObj?.message === "string" ? errObj.message : res.statusText;
        console.error("[WhatsAppAdapter] sendMessage error:", res.status, data);
        return { success: false, error: errMsg };
      }

      const messages = data.messages as Array<Record<string, unknown>> | undefined;
      const externalMessageId = typeof messages?.[0]?.id === "string" ? messages[0].id : undefined;

      return { success: true, externalMessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[WhatsAppAdapter] sendMessage fetch error:", err);
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
