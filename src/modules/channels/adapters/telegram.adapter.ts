import { timingSafeEqual } from "crypto";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface TelegramCredentials {
  botToken: string;
  // Secret token set via setWebhook secret_token param — used to verify incoming updates
  webhookSecret?: string;
}

interface TGUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TGPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TGDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TGAudio {
  file_id: string;
  duration: number;
  mime_type?: string;
  title?: string;
}

interface TGVideo {
  file_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
}

interface TGVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
}

interface TGSticker {
  file_id: string;
  width: number;
  height: number;
  is_animated: boolean;
}

interface TGLocation {
  longitude: number;
  latitude: number;
}

interface TGContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
}

interface TGMessage {
  message_id: number;
  from?: TGUser;
  date: number;
  text?: string;
  caption?: string;
  photo?: TGPhotoSize[];
  document?: TGDocument;
  audio?: TGAudio;
  video?: TGVideo;
  voice?: TGVoice;
  sticker?: TGSticker;
  location?: TGLocation;
  contact?: TGContact;
}

interface TGUpdate {
  update_id: number;
  message?: TGMessage;
  edited_message?: TGMessage;
  channel_post?: TGMessage;
}

interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
}

function buildSenderName(user: TGUser): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return parts || user.username || undefined;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "TELEGRAM";
  private credentials: TelegramCredentials;

  constructor(credentials: TelegramCredentials) {
    this.credentials = credentials;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      const update = body as unknown as TGUpdate;
      const message = update.message ?? update.edited_message ?? update.channel_post;

      if (!message) return null;

      const from = message.from;
      if (!from) return null;

      const senderId = String(from.id);
      const senderName = buildSenderName(from);
      const timestamp = new Date(message.date * 1000);
      const externalMessageId = `${message.message_id}`;

      let content = "";
      let messageType = "TEXT";
      let fileUrl: string | undefined;

      if (message.text) {
        content = message.text;
        messageType = "TEXT";
      } else if (message.photo && message.photo.length > 0) {
        // Telegram sends multiple resolutions; pick the largest
        const largest = message.photo.reduce((a, b) =>
          (a.file_size ?? 0) >= (b.file_size ?? 0) ? a : b
        );
        content = message.caption ?? "";
        messageType = "IMAGE";
        fileUrl = `tg-file:${largest.file_id}`;
      } else if (message.document) {
        content = message.caption ?? message.document.file_name ?? "";
        messageType = "DOCUMENT";
        fileUrl = `tg-file:${message.document.file_id}`;
      } else if (message.audio) {
        content = message.caption ?? message.audio.title ?? "";
        messageType = "AUDIO";
        fileUrl = `tg-file:${message.audio.file_id}`;
      } else if (message.video) {
        content = message.caption ?? "";
        messageType = "VIDEO";
        fileUrl = `tg-file:${message.video.file_id}`;
      } else if (message.voice) {
        content = "";
        messageType = "VOICE";
        fileUrl = `tg-file:${message.voice.file_id}`;
      } else if (message.sticker) {
        content = "";
        messageType = "STICKER";
        fileUrl = `tg-file:${message.sticker.file_id}`;
      } else if (message.location) {
        content = `${message.location.latitude},${message.location.longitude}`;
        messageType = "LOCATION";
      } else if (message.contact) {
        const c = message.contact;
        content = [c.first_name, c.last_name, c.phone_number].filter(Boolean).join(" ");
        messageType = "CONTACT";
      } else {
        // Unknown message type — still create an entry with empty content
        content = "";
        messageType = "UNKNOWN";
      }

      return {
        externalMessageId,
        senderExternalId: senderId,
        senderName,
        content,
        messageType,
        fileUrl,
        channel: this.channel,
        rawPayload: body,
        timestamp,
      };
    } catch (err) {
      console.error("[TelegramAdapter] parseInbound error:", err);
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
    const base = `https://api.telegram.org/bot${this.credentials.botToken}`;

    let endpoint: string;
    let payload: Record<string, unknown>;

    if (messageType === "IMAGE" && fileUrl) {
      endpoint = `${base}/sendPhoto`;
      payload = { chat_id: externalId, photo: fileUrl, caption: content };
    } else if (messageType === "VIDEO" && fileUrl) {
      endpoint = `${base}/sendVideo`;
      payload = { chat_id: externalId, video: fileUrl, caption: content };
    } else if (messageType === "AUDIO" && fileUrl) {
      endpoint = `${base}/sendAudio`;
      payload = { chat_id: externalId, audio: fileUrl, caption: content };
    } else if (messageType === "DOCUMENT" && fileUrl) {
      endpoint = `${base}/sendDocument`;
      payload = { chat_id: externalId, document: fileUrl, caption: content };
    } else {
      endpoint = `${base}/sendMessage`;
      payload = { chat_id: externalId, text: content, parse_mode: "HTML" };
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as TelegramSendResponse;

      if (!res.ok || !data.ok) {
        const errMsg = data.description ?? res.statusText;
        console.error("[TelegramAdapter] sendMessage error:", res.status, data);
        return { success: false, error: errMsg };
      }

      const msgId = data.result?.message_id;
      const externalMessageId = msgId !== undefined ? String(msgId) : undefined;

      console.log("[TelegramAdapter] Sent to chat", externalId, "msgId:", externalMessageId);
      return { success: true, externalMessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[TelegramAdapter] sendMessage fetch error:", err);
      return { success: false, error: message };
    }
  }

  verifySignature(headers: Record<string, string>, _body: string): boolean {
    // Telegram webhook verification uses a secret_token set during setWebhook.
    // Telegram sends it back in the X-Telegram-Bot-Api-Secret-Token header.
    const incoming =
      headers["x-telegram-bot-api-secret-token"] ??
      headers["X-Telegram-Bot-Api-Secret-Token"];

    if (!this.credentials.webhookSecret) {
      // If no secret is configured, skip verification (development mode)
      console.warn("[TelegramAdapter] webhookSecret not configured — skipping signature verification");
      return true;
    }

    if (!incoming) return false;

    try {
      return timingSafeEqual(
        Buffer.from(incoming),
        Buffer.from(this.credentials.webhookSecret)
      );
    } catch {
      return false;
    }
  }
}
