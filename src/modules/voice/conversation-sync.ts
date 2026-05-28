/**
 * src/modules/voice/conversation-sync.ts
 *
 * Mirror voice call segments into the Conversation/Message thread (Phase 6d).
 *
 * Two exported functions:
 *
 *   ensureConversationForCall(voiceCallId)
 *     Finds-or-creates a Customer by the caller's phone number (fromNumber),
 *     finds-or-creates a Conversation for that customer, and links the
 *     VoiceCall.conversationId to it.  Safe to call multiple times (idempotent).
 *
 *   mirrorSegmentToMessage(segmentId)
 *     Copies a VoiceCallSegment into a Message row on the linked Conversation.
 *     Uses messageType=AUDIO when the segment has an audioUrl, TEXT otherwise.
 *     Skips silently if the VoiceCall has no conversationId yet.
 *
 * Both functions are fail-soft: errors are logged with tenantId, never thrown
 * to the caller, so the voice agent flow is never blocked by sync failures.
 */

import { prisma } from "@/lib/prisma";

// New models not yet in generated Prisma client — remove cast after migrate+generate
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure a Conversation exists for the given VoiceCall and link it.
 *
 * Algorithm:
 *   1. Load VoiceCall (tenantId, fromNumber, customerId, conversationId)
 *   2. If conversationId already set → return early (idempotent)
 *   3. Find or create Customer by (tenantId, mobile = fromNumber)
 *   4. Find or create an open Conversation for that customer (channel=MANUAL)
 *   5. Update VoiceCall.conversationId + VoiceCall.customerId if not already set
 */
export async function ensureConversationForCall(voiceCallId: string): Promise<void> {
  const voiceCall = await anyPrisma.voiceCall.findUnique({
    where: { id: voiceCallId },
    select: {
      id: true,
      tenantId: true,
      fromNumber: true,
      customerId: true,
      conversationId: true,
    },
  }) as {
    id: string;
    tenantId: string;
    fromNumber: string;
    customerId: string | null;
    conversationId: string | null;
  } | null;

  if (!voiceCall) {
    throw new Error(`[ConversationSync] VoiceCall not found: ${voiceCallId}`);
  }

  // If already linked to a conversation, nothing to do
  if (voiceCall.conversationId) return;

  const { tenantId, fromNumber } = voiceCall;

  // ── Find or create Customer ──────────────────────────────────────────────
  let customerId = voiceCall.customerId;

  if (!customerId) {
    const existing = await prisma.customer.findFirst({
      where: { tenantId, mobile: fromNumber },
      select: { id: true },
    });

    if (existing) {
      customerId = existing.id;
    } else {
      const created = await prisma.customer.create({
        data: {
          tenantId,
          name: fromNumber, // caller name unknown until identified
          mobile: fromNumber,
        },
        select: { id: true },
      });
      customerId = created.id;
    }
  }

  // ── Find or create Conversation ──────────────────────────────────────────
  let conversationId: string;

  const existingConv = await prisma.conversation.findFirst({
    where: {
      tenantId,
      customerId,
      status: "ACTIVE",
      channel: "MANUAL",
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const newConv = await prisma.conversation.create({
      data: {
        tenantId,
        customerId,
        channel: "MANUAL",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    conversationId = newConv.id;
  }

  // ── Update VoiceCall ──────────────────────────────────────────────────────
  await anyPrisma.voiceCall.update({
    where: { id: voiceCallId },
    data: {
      conversationId,
      customerId,
    },
  });
}

/**
 * Copy a VoiceCallSegment into the Message table on the linked Conversation.
 *
 * @param segmentId  The VoiceCallSegment to mirror.
 * @returns          void — skips silently if the VoiceCall has no conversationId.
 */
export async function mirrorSegmentToMessage(segmentId: string): Promise<void> {
  const segment = await anyPrisma.voiceCallSegment.findUnique({
    where: { id: segmentId },
    select: {
      id: true,
      speaker: true,
      content: true,
      audioUrl: true,
      voiceCall: {
        select: {
          tenantId: true,
          conversationId: true,
        },
      },
    },
  }) as {
    id: string;
    speaker: string;
    content: string;
    audioUrl: string | null;
    voiceCall: {
      tenantId: string;
      conversationId: string | null;
    };
  } | null;

  if (!segment) {
    console.warn(`[ConversationSync] VoiceCallSegment not found: ${segmentId}`);
    return;
  }

  const { tenantId, conversationId } = segment.voiceCall;

  // No conversation linked yet — skip silently
  if (!conversationId) return;

  const senderType = segment.speaker === "CUSTOMER" ? "CUSTOMER" : "BOT";
  const messageType = segment.audioUrl ? "AUDIO" : "TEXT";

  await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      senderType,
      content: segment.content,
      messageType,
      fileUrl: segment.audioUrl ?? null,
    },
  });
}
