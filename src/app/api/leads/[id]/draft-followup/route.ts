import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { getActiveProvider } from "@/modules/ai/ai-router.service";
import { createProvider } from "@/modules/ai/providers";

// POST /api/leads/[id]/draft-followup — generate a personalised follow-up message via AI
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("follow-ups:create");

    // Fetch lead with customer and stage details
    const lead = await db.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: { select: { name: true, email: true, mobile: true } },
        department: { select: { name: true } },
        stage: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // RBAC: dept managers limited to their department; agents to their assigned leads
    if (user.role === "DEPT_MANAGER" && user.departmentId && lead.departmentId !== user.departmentId) {
      return forbidden();
    }
    if (user.role === "AGENT" && lead.assignedTo !== user.id) {
      return forbidden();
    }

    // Fetch recent conversation history (last 10 messages across all conversations)
    const conversations = await db.conversation.findMany({
      where: { leadId: id, tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            senderType: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    // Flatten and sort messages chronologically
    const recentMessages = conversations
      .flatMap((c) => c.messages)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-10);

    // Build conversation snippet for the prompt
    const conversationSnippet =
      recentMessages.length > 0
        ? recentMessages
            .map((m) => `[${m.senderType}]: ${m.content}`)
            .join("\n")
        : "No previous conversation history.";

    // Build lead context for the prompt
    const travelDateStr = lead.travelDate
      ? new Date(lead.travelDate).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "not specified";

    const leadContext = [
      `Customer: ${lead.customer?.name ?? "Unknown"}`,
      `Destination: ${lead.destination ?? "not specified"}`,
      `Travel date: ${travelDateStr}`,
      `Passengers: ${lead.numPassengers ?? "not specified"}`,
      `Priority: ${lead.priority}`,
      `Current pipeline stage: ${lead.stage?.name ?? "Unknown"}`,
      `Department: ${lead.department?.name ?? "Unknown"}`,
      lead.specialRequirement ? `Special requirements: ${lead.specialRequirement}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Retrieve active AI provider for this tenant
    const providerConfig = await getActiveProvider(db);
    if (!providerConfig) {
      return NextResponse.json(
        { error: "No active AI provider configured for this workspace" },
        { status: 503 }
      );
    }

    const provider = createProvider(
      providerConfig.provider,
      providerConfig.apiKey,
      providerConfig.model
    );

    const systemPrompt = `You are an expert travel CRM assistant. Your job is to help travel agents write personalised, warm, and professional follow-up messages to potential customers. Always write in a friendly, helpful tone. Do not include placeholder text like "[Agent Name]" — use context provided instead. Return a JSON object with exactly two fields: "message" (the follow-up text) and "suggestedTime" (an ISO 8601 timestamp representing the best time to send this follow-up, based on urgency derived from travel date and stage).`;

    const userPrompt = `Write a personalised follow-up message for this travel lead:

Lead details:
${leadContext}

Recent conversation history:
${conversationSnippet}

Agent sending the message: ${user.name}

Instructions:
- Reference specific details about the customer's trip (destination, date, passengers) naturally.
- Match the tone to the pipeline stage (e.g. more urgent if travel date is soon).
- Keep it under 150 words.
- Suggest the best time to send this message as an ISO 8601 datetime.

Respond ONLY with a valid JSON object: {"message": "...", "suggestedTime": "..."}`;

    // Collect the full streamed response
    let rawOutput = "";
    const stream = provider.chat({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 512,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      if (chunk.type === "text" && chunk.content) {
        rawOutput += chunk.content;
      }
    }

    // Parse the JSON response from the AI
    let parsed: { message: string; suggestedTime: string };
    try {
      // Strip markdown code fences if present
      const cleaned = rawOutput.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If the AI returned plain text instead of JSON, surface it directly
      return NextResponse.json({
        message: rawOutput.trim(),
        suggestedTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!parsed.message || typeof parsed.message !== "string") {
      return NextResponse.json(
        { error: "AI provider returned an unexpected response format" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      message: parsed.message,
      suggestedTime: parsed.suggestedTime ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/leads/[id]/draft-followup error:", error);
    return NextResponse.json({ error: "Failed to generate follow-up draft" }, { status: 500 });
  }
}
