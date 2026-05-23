import type { ChatMessage } from "./providers/provider.interface";

export type { ChatMessage };

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

export type RouteDecision = {
  route: "ai" | "human";
  reason?: string;
};

// Patterns that signal the customer wants a human agent
const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /speak\s+to\s+a\s+(person|human|agent|representative|rep)/i,
  /talk\s+to\s+(someone|a\s+person|a\s+human|an\s+agent|a\s+representative)/i,
  /connect\s+me\s+(to|with)\s+(a\s+)?(person|human|agent|representative|rep|manager)/i,
  /transfer\s+me\s+(to|with)\s+(a\s+)?(person|human|agent|representative)/i,
  /live\s+agent/i,
  /real\s+(person|human|agent)/i,
  /human\s+(support|help|agent|representative)/i,
  /i\s+want\s+to\s+talk\s+to\s+(a\s+)?(person|human|agent)/i,
  /get\s+me\s+(a\s+)?(manager|supervisor|human)/i,
];

// Keywords that indicate escalation-worthy issues
const ESCALATION_KEYWORDS: RegExp[] = [
  /\bcomplaint\b/i,
  /\brefund\b/i,
  /\bcancel(lation)?\b/i,
  /\blegal\b/i,
  /\blawyer\b/i,
  /\bsue\b|\bsuing\b|\blawsuit\b/i,
  /\bfraud\b/i,
  /\bscam\b/i,
  /\bchargeback\b/i,
  /\bdispute\b/i,
  /\bthreaten\b|\bthreat\b/i,
  /\bpolice\b|\bcourt\b/i,
];

/**
 * Determines whether an incoming message should be handled by AI or
 * immediately routed to a human agent.
 *
 * Rules (evaluated in priority order):
 *  1. Conversation is already in HUMAN_TAKEOVER — always route to human.
 *  2. Customer explicitly requests a human — route to human.
 *  3. Message contains escalation keywords — route to human.
 *  4. Otherwise — route to AI.
 */
export function shouldRouteToAI(
  message: string,
  conversationStatus: string
): RouteDecision {
  // Rule 1: Conversation has already been taken over by a human agent
  if (conversationStatus === "HUMAN_TAKEOVER") {
    return {
      route: "human",
      reason: "Conversation is already in HUMAN_TAKEOVER status",
    };
  }

  // Rule 2: Customer is explicitly requesting a human
  const requestsHuman = HUMAN_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(message)
  );
  if (requestsHuman) {
    return {
      route: "human",
      reason: "Customer explicitly requested a human agent",
    };
  }

  // Rule 3: Message contains escalation-worthy keywords
  const hasEscalationKeyword = ESCALATION_KEYWORDS.some((pattern) =>
    pattern.test(message)
  );
  if (hasEscalationKeyword) {
    return {
      route: "human",
      reason: "Message contains escalation keyword requiring human review",
    };
  }

  return { route: "ai" };
}

/**
 * Finds the active AI provider configuration for the current tenant.
 * Returns null if no active provider is configured.
 */
export async function getActiveProvider(db: TenantDb) {
  const provider = await db.aIProvider.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return provider;
}
