import nodemailer from "nodemailer";
import type { ChannelAdapter, InboundMessage, SendResult } from "./adapter.interface";

interface EmailCredentials {
  // SMTP outbound
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  // SendGrid inbound parse basic-auth (optional)
  inboundUser?: string;
  inboundPass?: string;
  // Allowed IP ranges for SendGrid inbound parse (optional, comma-separated CIDRs)
  allowedIps?: string;
}

interface SendGridInboundFields {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  "attachment-info"?: string;
  attachments?: string;
  envelope?: string;
  charsets?: string;
  dkim?: string;
  SPF?: string;
  spam_score?: string;
  spam_report?: string;
  sender_ip?: string;
  headers?: string;
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

function extractName(raw: string): string | undefined {
  const match = raw.match(/^([^<]+)<[^>]+>/);
  if (match) return match[1].trim().replace(/^"|"$/g, "");
  return undefined;
}

function generateMessageId(): string {
  return `email-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class EmailAdapter implements ChannelAdapter {
  readonly channel = "EMAIL";
  private credentials: EmailCredentials;
  private transporter: nodemailer.Transporter | null = null;

  constructor(credentials: EmailCredentials) {
    this.credentials = credentials;
  }

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    this.transporter = nodemailer.createTransport({
      host: this.credentials.smtpHost,
      port: this.credentials.smtpPort,
      secure: this.credentials.smtpPort === 465,
      auth: {
        user: this.credentials.smtpUser,
        pass: this.credentials.smtpPass,
      },
    });

    return this.transporter;
  }

  parseInbound(body: Record<string, unknown>): InboundMessage | null {
    try {
      // SendGrid inbound parse delivers fields as form-encoded key/value pairs
      const fields = body as SendGridInboundFields;

      const fromRaw = fields.from ?? "";
      if (!fromRaw) return null;

      const senderEmail = extractEmail(fromRaw);
      const senderName = extractName(fromRaw);

      const subject = fields.subject ?? "(no subject)";
      const textContent = fields.text ?? "";
      const htmlContent = fields.html ?? "";

      // Prefer plain text; fall back to a stripped version of HTML
      const content = textContent.trim() || htmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      // Check for attachments
      let fileUrl: string | undefined;
      let messageType = "TEXT";

      const attachmentInfo = fields["attachment-info"];
      if (attachmentInfo) {
        try {
          const info = JSON.parse(attachmentInfo) as Record<string, unknown>;
          const firstKey = Object.keys(info)[0];
          if (firstKey) {
            const att = info[firstKey] as Record<string, unknown>;
            const contentType = typeof att["content-type"] === "string" ? att["content-type"] : "";
            if (contentType.startsWith("image/")) {
              messageType = "IMAGE";
            } else if (contentType.startsWith("audio/")) {
              messageType = "AUDIO";
            } else if (contentType.startsWith("video/")) {
              messageType = "VIDEO";
            } else {
              messageType = "DOCUMENT";
            }
            // SendGrid provides attachment data in the body as attachment1, attachment2, etc.
            // The actual file data would need to be extracted by the webhook handler.
            // We mark the type and leave fileUrl as a reference key.
            fileUrl = `sendgrid-attachment:${firstKey}`;
          }
        } catch {
          // malformed attachment-info — ignore
        }
      }

      return {
        externalMessageId: generateMessageId(),
        senderExternalId: senderEmail,
        senderName,
        content: subject ? `Subject: ${subject}\n\n${content}` : content,
        messageType,
        fileUrl,
        channel: this.channel,
        rawPayload: body,
        timestamp: new Date(),
      };
    } catch (err) {
      console.error("[EmailAdapter] parseInbound error:", err);
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
    const { externalId, content, metadata } = params;

    const subject =
      typeof metadata?.subject === "string" ? metadata.subject : "Message from Support";

    const htmlBody = content.replace(/\n/g, "<br>");

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: this.credentials.smtpFrom,
        to: externalId,
        subject,
        text: content,
        html: `<p>${htmlBody}</p>`,
      }) as { messageId?: string };

      const externalMessageId =
        typeof info?.messageId === "string" ? info.messageId : undefined;

      console.log("[EmailAdapter] Sent to", externalId, "msgId:", externalMessageId);
      return { success: true, externalMessageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[EmailAdapter] sendMessage error:", err);
      return { success: false, error: message };
    }
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    // SendGrid inbound parse does not provide HMAC signatures.
    // Verification strategies:
    // 1. Basic Auth on the inbound webhook URL
    // 2. IP allowlist (SendGrid publishes their IP ranges)

    // Basic auth check
    const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
    if (authHeader.startsWith("Basic ") && this.credentials.inboundUser && this.credentials.inboundPass) {
      const encoded = Buffer.from(
        `${this.credentials.inboundUser}:${this.credentials.inboundPass}`
      ).toString("base64");
      return authHeader === `Basic ${encoded}`;
    }

    // IP-based allowlist check (when no basic auth is configured)
    if (this.credentials.allowedIps) {
      const senderIp =
        headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
        headers["x-real-ip"] ??
        body; // body unused here; this prevents unused-param lint

      const allowedList = this.credentials.allowedIps
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean);

      return allowedList.includes(senderIp);
    }

    // If neither is configured, permit (caller should enforce network-level restrictions)
    console.warn("[EmailAdapter] No inbound verification configured — accepting all requests");
    return true;
  }
}
