import { tenantPrisma } from "@/lib/prisma";
import { createChannelAdapter } from "./adapters/index";
import type { MessageType } from "@prisma/client";

/**
 * Dispatches an outbound message from the CRM to a customer via their
 * channel-specific adapter.
 *
 * Steps:
 *  1. Load the conversation to get channel + customerId.
 *  2. Load the active ChannelConfig for that channel.
 *  3. Look up the CustomerChannel record to obtain the externalId.
 *  4. Instantiate the adapter and send.
 *  5. Save a MessageDelivery record with the outcome.
 */
export async function dispatchMessage(
  tenantId: string,
  conversationId: string,
  content: string,
  messageType: string,
  fileUrl?: string
): Promise<{ success: boolean; externalMessageId?: string; error?: string }> {
  const db = tenantPrisma(tenantId);

  // Load conversation
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId },
  });

  if (!conversation) {
    return { success: false, error: "Conversation not found" };
  }

  if (!conversation.customerId) {
    return { success: false, error: "Conversation has no linked customer" };
  }

  const { channel, customerId } = conversation;

  // Load active channel config
  const channelConfig = await db.channelConfig.findFirst({
    where: { channel, isActive: true },
  });

  if (!channelConfig) {
    return { success: false, error: `No active channel config for ${channel}` };
  }

  // Load external ID for this customer on this channel
  const customerChannel = await db.customerChannel.findFirst({
    where: { customerId, channel },
  });

  if (!customerChannel) {
    return { success: false, error: "No external ID found for this customer on this channel" };
  }

  // Create the outbound Message record first so we have an ID for MessageDelivery
  const safeType = toMessageType(messageType);
  const message = await db.message.create({
    data: {
      conversationId,
      senderType: "AGENT",
      senderId: null,
      content,
      messageType: safeType,
      fileUrl: fileUrl ?? null,
    },
  });

  // Instantiate adapter and send
  let sendResult: { success: boolean; externalMessageId?: string; error?: string };
  try {
    const adapter = createChannelAdapter(channel, channelConfig.credentials);
    sendResult = await adapter.sendMessage({
      externalId: customerChannel.externalId,
      content,
      messageType,
      fileUrl,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[MessageDispatcher] adapter error:", errMsg);
    sendResult = { success: false, error: errMsg };
  }

  // Persist delivery record
  await db.messageDelivery.create({
    data: {
      messageId: message.id,
      externalMessageId: sendResult.externalMessageId ?? null,
      status: sendResult.success ? "SENT" : "FAILED",
      errorMessage: sendResult.error ?? null,
      sentAt: sendResult.success ? new Date() : null,
    },
  });

  return sendResult;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toMessageType(raw: string): MessageType {
  const valid: MessageType[] = ["TEXT", "IMAGE", "FILE", "AUDIO", "VIDEO", "LOCATION", "TEMPLATE"];
  const upper = raw.toUpperCase() as MessageType;
  return valid.includes(upper) ? upper : "TEXT";
}
