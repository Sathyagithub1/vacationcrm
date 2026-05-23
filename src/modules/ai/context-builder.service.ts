import type { ChatMessage } from "./providers/provider.interface";

export type { ChatMessage };

type TenantDb = ReturnType<typeof import("@/lib/prisma").tenantPrisma>;

/**
 * Builds a system prompt that instructs the AI how to behave as a customer
 * service assistant for the given department and tenant.
 */
export async function buildSystemPrompt(
  db: TenantDb,
  departmentId: string,
  tenantId: string
): Promise<string> {
  const [department, tenant] = await Promise.all([
    db.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: {
        name: true,
        description: true,
        contactEmail: true,
        contactPhone: true,
        websiteUrl: true,
      },
    }),
    // Tenant model is excluded from tenantId scoping inside tenantPrisma,
    // so we query it directly through the db proxy (it will skip the where
    // injection for Tenant per the tenantPrisma guard).
    db.tenant.findFirst({
      where: { id: tenantId },
      select: {
        name: true,
        productName: true,
        timezone: true,
        currency: true,
      },
    }),
  ]);

  const deptName = department?.name ?? "Customer Support";
  const deptDesc = department?.description
    ? `\nDepartment description: ${department.description}`
    : "";
  const contactLine =
    department?.contactEmail || department?.contactPhone
      ? `\nDepartment contact — Email: ${department.contactEmail ?? "—"}, Phone: ${department.contactPhone ?? "—"}`
      : "";
  const websiteLine = department?.websiteUrl
    ? `\nWebsite: ${department.websiteUrl}`
    : "";

  const tenantName = tenant?.productName ?? tenant?.name ?? "our service";
  const timezone = tenant?.timezone ?? "UTC";
  const currency = tenant?.currency ?? "INR";

  return `You are a helpful and professional customer service assistant for the ${deptName} team at ${tenantName}.${deptDesc}${contactLine}${websiteLine}

## Your responsibilities
- Greet customers warmly and introduce yourself as the ${deptName} assistant.
- Answer questions accurately using only the information provided to you in this context.
- Do NOT invent facts, pricing, policies, or any information not explicitly given to you.
- If you do not know the answer, say so honestly and offer to connect the customer with a human agent.

## Capturing contact details
- If the customer has not already provided their name, mobile number, or email, politely ask for them during the conversation.
- Store any provided contact details by repeating them back to confirm accuracy.

## Handling complaints
- Acknowledge the customer's frustration with empathy before offering solutions.
- Never argue with or dismiss a complaint — validate the concern first.
- For serious complaints (legal threats, fraud claims, requests for refunds beyond standard policy), immediately offer to escalate to a human agent.

## Escalation triggers
- If a customer explicitly asks to speak with a human, a manager, or a live agent, acknowledge the request and inform them that you are connecting them with a human representative now.
- Do not attempt to resolve issues that require access to internal systems, order management, or policy exceptions that are outside your provided knowledge.

## Tone & style
- Be friendly, concise, and professional at all times.
- Avoid jargon. Use plain language appropriate for general audiences.
- All monetary amounts should be formatted in ${currency}. Business hours and dates should reference the ${timezone} timezone.

## Hard limits
- Never share confidential internal data, other customers' information, or system credentials.
- Never make promises about timelines, refunds, or outcomes unless the knowledge base explicitly states such a policy.
- Never pretend to be a human if the customer sincerely asks whether they are speaking to a bot.`;
}

/**
 * Fetches all active knowledge base entries for the department and formats
 * them as a structured string grouped by entry type.
 */
export async function buildKnowledgeContext(
  db: TenantDb,
  departmentId: string
): Promise<string> {
  const entries = await db.knowledgeBase.findMany({
    where: { departmentId, isActive: true },
    select: { type: true, title: true, content: true },
    orderBy: [{ type: "asc" }, { title: "asc" }],
  });

  if (entries.length === 0) {
    return "";
  }

  // Group by type
  const grouped = entries.reduce<Record<string, typeof entries>>(
    (acc, entry) => {
      if (!acc[entry.type]) acc[entry.type] = [];
      acc[entry.type].push(entry);
      return acc;
    },
    {}
  );

  const typeLabels: Record<string, string> = {
    FAQ: "Frequently Asked Questions",
    SOP: "Standard Operating Procedures",
    PRICING: "Pricing Information",
    DOCUMENT: "Reference Documents",
    CUSTOM: "Additional Information",
  };

  const sections = Object.entries(grouped).map(([type, items]) => {
    const label = typeLabels[type] ?? type;
    const entries = items
      .map((e) => `### ${e.title}\n${e.content}`)
      .join("\n\n");
    return `## ${label}\n\n${entries}`;
  });

  return `# Knowledge Base\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * Fetches the most recent messages for a conversation and maps them to the
 * ChatMessage format expected by AI provider adapters.
 *
 * Sender mapping:
 *   CUSTOMER  → "user"
 *   BOT/AGENT → "assistant"
 */
export async function buildConversationHistory(
  db: TenantDb,
  conversationId: string,
  limit: number = 20
): Promise<ChatMessage[]> {
  const messages = await db.message.findMany({
    where: { conversationId },
    select: { senderType: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Reverse so the slice is chronological (oldest first)
  return messages.reverse().map((msg) => ({
    role: msg.senderType === "CUSTOMER" ? "user" : "assistant",
    content: msg.content,
  }));
}
