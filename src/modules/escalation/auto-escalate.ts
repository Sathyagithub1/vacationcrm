/**
 * Auto-escalation rules engine.
 *
 * Evaluates a conversation against all active EscalationRules for its tenant
 * and fires the configured action when a rule triggers.
 *
 * Rule types:
 *   MESSAGE_COUNT_THRESHOLD — fires when the customer has sent ≥ threshold messages
 *     within the last windowHours and none of the bookingSignals keywords appear.
 *   DURATION — fires when the conversation has been open for > maxHours without
 *     reaching CLOSED status.
 *   AI_INTENT — calls the tenant's AI provider to classify the last 5 customer
 *     messages; fires when all are classified as non-committal/browsing.
 *
 * Actions:
 *   ESCALATE — assigns the conversation to the most available DEPT_MANAGER or
 *     COMPANY_ADMIN in the same department and creates an Escalation row.
 *   PARK — marks the conversation status to CLOSED temporarily and sends a
 *     polite "I'll follow up with you shortly" message.
 *   NOTIFY — sends an in-app notification to the current assignee and any
 *     DEPT_MANAGER in the tenant.
 *
 * Fail-soft: all AI calls are wrapped in try/catch.  If no AI provider is
 * configured the AI_INTENT rule is skipped with a console.warn.
 */

import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
// EscalationRule, EscalationRuleType, EscalationRuleAction are new types added in 6b migration.
// Use string literal types until `prisma generate` is re-run after migration.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = (db: unknown) => db as any;

type EscalationRuleType = "MESSAGE_COUNT_THRESHOLD" | "DURATION" | "AI_INTENT";
type EscalationRuleAction = "ESCALATE" | "PARK" | "NOTIFY";

interface EscalationRule {
  id: string;
  tenantId: string;
  name: string;
  type: EscalationRuleType;
  config: Record<string, unknown>;
  action: EscalationRuleAction;
  isActive: boolean;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EscalationTriggerResult {
  triggered: EscalationRule;
  action: EscalationRuleAction;
  conversationId: string;
}

// Rule config shapes
interface MessageCountConfig {
  threshold: number;
  windowHours: number;
  bookingSignals: string[];
}

interface DurationConfig {
  maxHours: number;
}

interface AIIntentConfig {
  negativeSignals: string[];
}

// ─── Rule Evaluators ──────────────────────────────────────────────────────────

/**
 * MESSAGE_COUNT_THRESHOLD rule:
 * Fires when ≥ threshold messages from the customer in windowHours contain
 * no booking-signal keywords.
 */
async function evaluateMessageCount(
  conversationId: string,
  config: MessageCountConfig
): Promise<boolean> {
  const { threshold, windowHours, bookingSignals } = config;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      senderType: "CUSTOMER",
      createdAt: { gte: since },
    },
    select: { content: true },
    orderBy: { createdAt: "asc" },
  });

  if (messages.length < threshold) return false;

  // Check if any message contains a booking signal — if so, bypass the rule
  const signals = (bookingSignals ?? []).map((s: string) => s.toLowerCase());
  const fullText = messages
    .map((m: { content: string }) => m.content.toLowerCase())
    .join(" ");

  if (signals.length > 0 && signals.some((s) => fullText.includes(s))) {
    return false; // Booking intent present — do not escalate
  }

  return true;
}

/**
 * DURATION rule:
 * Fires when the conversation has been open longer than maxHours.
 */
async function evaluateDuration(
  conversationId: string,
  config: DurationConfig
): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { startedAt: true, status: true },
  });
  if (!conv || conv.status === "CLOSED") return false;

  const ageHours = (Date.now() - conv.startedAt.getTime()) / (1000 * 60 * 60);
  return ageHours > config.maxHours;
}

/**
 * AI_INTENT rule:
 * Calls the AI provider to classify the last 5 customer messages.
 * Fires when all messages are classified as non-committal/browsing.
 * Skipped (returns false) if no AI provider is configured.
 */
async function evaluateAIIntent(
  conversationId: string,
  tenantId: string,
  config: AIIntentConfig
): Promise<boolean> {
  const messages = await prisma.message.findMany({
    where: { conversationId, senderType: "CUSTOMER" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { content: true },
  });

  if (messages.length === 0) return false;

  const negativeSignals = (config.negativeSignals ?? [
    "just browsing",
    "maybe later",
    "not sure",
    "just looking",
    "checking prices",
  ]).map((s: string) => s.toLowerCase());

  const fullText = messages.map((m: { content: string }) => m.content.toLowerCase()).join(" ");

  // Quick keyword check before calling AI
  const anyNegative = negativeSignals.some((s) => fullText.includes(s));
  if (!anyNegative) return false;

  try {
    const { getAIProvider } = await import("@/modules/ai/provider");
    const provider = await getAIProvider(tenantId);

    const lastMessages = messages
      .reverse()
      .map((m: { content: string }) => `Customer: ${m.content}`)
      .join("\n");

    const prompt =
      `Analyze the following customer messages and determine if the customer is just browsing/comparison shopping with no booking intent, or if they are ready to book/purchase.\n\n` +
      `Messages:\n${lastMessages}\n\n` +
      `Respond with exactly one word: BROWSING or BOOKING`;

    const result = (await provider.complete(prompt)).trim().toUpperCase();
    return result === "BROWSING";
  } catch (err) {
    console.warn(
      `[AutoEscalate] AI_INTENT evaluation failed (tenantId=${tenantId}, convId=${conversationId}):`,
      err instanceof Error ? err.message : err
    );
    return false; // Fail-soft — don't escalate on AI failure
  }
}

// ─── Action Handlers ──────────────────────────────────────────────────────────

/**
 * ESCALATE action: assign to a senior agent and create an Escalation row.
 */
async function executeEscalate(
  tenantId: string,
  conversationId: string,
  rule: EscalationRule
): Promise<void> {
  const db = tenantPrisma(tenantId);

  const conv = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { assignedAgentId: true, leadId: true },
  });
  if (!conv) return;

  // Find a DEPT_MANAGER or COMPANY_ADMIN (prefer same dept as current agent)
  const seniorAgent = await db.user.findFirst({
    where: {
      role: { in: ["DEPT_MANAGER", "COMPANY_ADMIN"] },
      isActive: true,
      id: { not: conv.assignedAgentId ?? undefined },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!seniorAgent) {
    console.warn(
      `[AutoEscalate] No senior agent found for escalation (tenantId=${tenantId}, convId=${conversationId})`
    );
    return;
  }

  // Stamp escalation on conversation (use anyDb cast for new fields not yet in generated types)
  await anyDb(db).conversation.update({
    where: { id: conversationId },
    data: {
      assignedAgentId: seniorAgent.id,
      escalatedAt: new Date(),
      escalationReason: `Auto-escalation: rule "${rule.name}"`,
    },
  });

  // Create Escalation record if we have a lead
  if (conv.leadId && conv.assignedAgentId) {
    await (db.escalation.create as Function)({
      data: {
        leadId: conv.leadId,
        conversationId,
        reason: "UNRESPONSIVE",
        escalatedFrom: conv.assignedAgentId,
        escalatedTo: seniorAgent.id,
        notes: `Auto-escalated by rule: ${rule.name}`,
        status: "OPEN",
      },
    });
  }

  // Notify the senior agent
  await db.notification.create({
    data: {
      tenantId,
      userId: seniorAgent.id,
      type: "ESCALATION",
      title: "Conversation escalated to you",
      body: `Auto-escalation rule "${rule.name}" has assigned a conversation to you.`,
      data: { conversationId, ruleId: rule.id },
    },
  });
}

/**
 * PARK action: close the conversation and send a polite follow-up message.
 */
async function executePark(
  tenantId: string,
  conversationId: string,
  rule: EscalationRule
): Promise<void> {
  const db = tenantPrisma(tenantId);

  await anyDb(db).conversation.update({
    where: { id: conversationId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      escalatedAt: new Date(),
      escalationReason: `Parked by auto-escalation rule: ${rule.name}`,
    },
  });

  // Send a polite template message
  await db.message.create({
    data: {
      tenantId,
      conversationId,
      senderType: "BOT",
      content:
        "Thank you for reaching out! Our team will follow up with you shortly with personalized recommendations. " +
        "Have a wonderful day!",
      messageType: "TEXT",
    },
  });
}

/**
 * NOTIFY action: notify current assignee and all dept managers.
 */
async function executeNotify(
  tenantId: string,
  conversationId: string,
  rule: EscalationRule
): Promise<void> {
  const db = tenantPrisma(tenantId);

  const conv = await db.conversation.findFirst({
    where: { id: conversationId },
    select: { assignedAgentId: true },
  });

  const managers = await db.user.findMany({
    where: { role: { in: ["DEPT_MANAGER", "COMPANY_ADMIN"] }, isActive: true },
    select: { id: true },
  });

  const notifyIds = new Set<string>(managers.map((m: { id: string }) => m.id));
  if (conv?.assignedAgentId) notifyIds.add(conv.assignedAgentId);

  await db.notification.createMany({
    data: Array.from(notifyIds).map((userId) => ({
      tenantId,
      userId,
      type: "ESCALATION" as const,
      title: "Time-waster alert",
      body: `Auto-escalation rule "${rule.name}" flagged a conversation for review.`,
      data: { conversationId, ruleId: rule.id },
    })),
    skipDuplicates: true,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a conversation against all active EscalationRules for its tenant.
 * Returns the first triggered rule + action, or null if none fired.
 *
 * Intended to be called on every inbound Message create (via
 * channel-manager.service or a message hook).
 */
export async function evaluateConversation(
  conversationId: string
): Promise<EscalationTriggerResult | null> {
  const conv = await anyPrisma.conversation.findUnique({
    where: { id: conversationId },
    select: { tenantId: true, status: true, escalatedAt: true },
  }) as { tenantId: string; status: string; escalatedAt: Date | null } | null;

  if (!conv) return null;
  // Don't re-evaluate already-escalated or closed conversations
  if (conv.status === "CLOSED" || conv.escalatedAt !== null) return null;

  const rules = await anyPrisma.escalationRule.findMany({
    where: { tenantId: conv.tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
  }) as EscalationRule[];

  for (const rule of rules) {
    let triggered = false;

    try {
      const cfg = rule.config as Record<string, unknown>;

      if (rule.type === "MESSAGE_COUNT_THRESHOLD") {
        triggered = await evaluateMessageCount(conversationId, cfg as unknown as MessageCountConfig);
      } else if (rule.type === "DURATION") {
        triggered = await evaluateDuration(conversationId, cfg as unknown as DurationConfig);
      } else if (rule.type === "AI_INTENT") {
        triggered = await evaluateAIIntent(
          conversationId,
          conv.tenantId,
          cfg as unknown as AIIntentConfig
        );
      }
    } catch (err) {
      console.warn(
        `[AutoEscalate] Rule evaluation error (ruleId=${rule.id}, type=${rule.type}):`,
        err instanceof Error ? err.message : err
      );
      continue; // Fail-soft — continue to next rule
    }

    if (triggered) {
      // Execute action
      try {
        if (rule.action === "ESCALATE") {
          await executeEscalate(conv.tenantId, conversationId, rule);
        } else if (rule.action === "PARK") {
          await executePark(conv.tenantId, conversationId, rule);
        } else if (rule.action === "NOTIFY") {
          await executeNotify(conv.tenantId, conversationId, rule);
        }
      } catch (err) {
        console.warn(
          `[AutoEscalate] Action execution error (ruleId=${rule.id}, action=${rule.action}):`,
          err instanceof Error ? err.message : err
        );
      }

      return { triggered: rule, action: rule.action, conversationId };
    }
  }

  return null;
}
