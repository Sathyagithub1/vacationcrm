import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const scheduleCallbackTool: AITool = {
  definition: {
    name: "schedule_callback",
    description:
      "Schedules a callback for a customer at their preferred time. IMPORTANT: A lead must already exist for this conversation (use create_lead first if it does not). The customer must provide a preferred callback time. Use this when the customer explicitly asks to be called back or when they are unavailable right now.",
    parameters: {
      type: "object",
      properties: {
        preferredTime: {
          type: "string",
          description:
            "Customer's preferred callback time in ISO 8601 format (YYYY-MM-DDTHH:MM:SS). Derive from what the customer says, e.g. 'tomorrow at 3pm' should be converted to the correct datetime.",
        },
        notes: {
          type: "string",
          description:
            "Optional notes for the agent about this callback (e.g. customer wants to discuss Maldives package pricing).",
        },
      },
      required: ["preferredTime"],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { preferredTime, notes } = args as { preferredTime: string; notes?: string };

    // Guard: resolve the leadId from the conversation record
    const conversation = await ctx.db.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { leadId: true },
    });

    if (!conversation?.leadId) {
      return {
        success: false,
        message:
          "I need a few details before I can schedule a callback. Could you please share your name and phone number? I'll create a record first and then arrange the callback.",
      };
    }

    // Validate the provided datetime
    const callbackAt = new Date(preferredTime);
    if (isNaN(callbackAt.getTime())) {
      return {
        success: false,
        message:
          "The callback time provided could not be understood. Please specify a clear date and time (e.g. 'tomorrow at 3 PM' or '2026-06-01 15:00').",
      };
    }

    if (callbackAt <= new Date()) {
      return {
        success: false,
        message: "The callback time must be in the future. Please provide a future date and time.",
      };
    }

    try {
      const callback = await (ctx.db.callback.create as Function)({
        data: {
          tenantId: ctx.tenantId,
          leadId: conversation.leadId,
          departmentId: ctx.departmentId,
          preferredTime: callbackAt,
          notes: notes ?? null,
          status: "SCHEDULED",
        },
      });

      return {
        success: true,
        data: {
          callbackId: callback.id,
          leadId: conversation.leadId,
          preferredTime: callbackAt.toISOString(),
        },
        message: `Callback scheduled for ${callbackAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. An agent will call you at the requested time.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error scheduling callback.";
      return { success: false, message };
    }
  },
};
