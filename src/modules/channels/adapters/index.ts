import type { ChannelAdapter } from "./adapter.interface";
import { WhatsAppAdapter } from "./whatsapp.adapter";
import { FacebookAdapter } from "./facebook.adapter";
import { InstagramAdapter } from "./instagram.adapter";
import { EmailAdapter } from "./email.adapter";
import { SMSAdapter } from "./sms.adapter";
import { TelegramAdapter } from "./telegram.adapter";
import { decrypt } from "@/lib/encryption";

export type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

export function createChannelAdapter(channel: string, encryptedCredentials: string): ChannelAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const credentials = JSON.parse(decrypt(encryptedCredentials)) as any;
  switch (channel) {
    case "WHATSAPP":
      return new WhatsAppAdapter(credentials);
    case "FACEBOOK":
      return new FacebookAdapter(credentials);
    case "INSTAGRAM":
      return new InstagramAdapter(credentials);
    case "EMAIL":
      return new EmailAdapter(credentials);
    case "SMS":
      return new SMSAdapter(credentials);
    case "TELEGRAM":
      return new TelegramAdapter(credentials);
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}
