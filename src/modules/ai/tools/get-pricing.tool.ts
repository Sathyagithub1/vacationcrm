import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const getPricingTool: AITool = {
  definition: {
    name: "get_pricing",
    description:
      "Retrieves pricing information from the knowledge base that matches a destination or package query. Use this when the customer asks about cost, price, rates, packages, or budget for a specific destination or trip type. Only returns PRICING type KB entries.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The destination or package description to search pricing for (e.g. 'Bali 5 nights', 'Europe tour', 'honeymoon packages').",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { query } = args as { query: string };

    try {
      const term = query.toLowerCase().trim();

      const entries = await ctx.db.knowledgeBase.findMany({
        where: {
          departmentId: ctx.departmentId,
          isActive: true,
          type: "PRICING",
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { content: { contains: term, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, content: true, updatedAt: true },
      });

      if (entries.length === 0) {
        return {
          success: true,
          data: { results: [] },
          message: `No pricing information found for "${query}". Let the customer know that an agent will provide a personalised quote.`,
        };
      }

      const results = entries.map((e) => ({
        id: e.id,
        title: e.title,
        pricing: e.content.length > 600 ? `${e.content.slice(0, 600)}…` : e.content,
        lastUpdated: e.updatedAt,
      }));

      return {
        success: true,
        data: { results },
        message: `Found ${entries.length} pricing entry(ies) matching "${query}".`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error retrieving pricing.";
      return { success: false, message };
    }
  },
};
