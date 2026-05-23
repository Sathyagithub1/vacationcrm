import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const handoffTool: AITool = {
  definition: {
    name: "handoff_to_agent",
    description:
      "Transfers the conversation to a human agent by setting the conversation status to HUMAN_TAKEOVER. Use this when: (1) the customer explicitly asks to speak to a human, (2) the query is too complex for the bot, (3) there has been a repeated misunderstanding, or (4) the customer expresses strong frustration. Always inform the customer before transferring.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "Brief reason for the handoff that will be visible to the receiving agent (e.g. 'Customer requested human agent', 'Complex group booking inquiry', 'Payment dispute').",
        },
      },
      required: ["reason"],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { reason } = args as { reason: string };

    try {
      await ctx.db.conversation.update({
        where: { id: ctx.conversationId },
        data: { status: "HUMAN_TAKEOVER" },
      });

      return {
        success: true,
        data: {
          conversationId: ctx.conversationId,
          status: "HUMAN_TAKEOVER",
          reason,
        },
        message: `Conversation transferred to a human agent. Reason: ${reason}. The customer has been informed.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during handoff.";
      return { success: false, message };
    }
  },
};
