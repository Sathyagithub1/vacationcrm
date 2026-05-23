export interface InboundMessage {
  externalMessageId: string;
  senderExternalId: string;
  senderName?: string;
  content: string;
  messageType: string;
  fileUrl?: string;
  channel: string;
  rawPayload: Record<string, unknown>;
  timestamp: Date;
}

export interface SendResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
}

export interface ChannelAdapter {
  channel: string;
  parseInbound(body: Record<string, unknown>): InboundMessage | null;
  sendMessage(params: {
    externalId: string;
    content: string;
    messageType: string;
    fileUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SendResult>;
  verifySignature(headers: Record<string, string>, body: string): boolean;
}
