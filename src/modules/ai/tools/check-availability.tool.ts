import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const checkAvailabilityTool: AITool = {
  definition: {
    name: "check_availability",
    description:
      "Searches the department's knowledge base for availability information that matches a destination or package query. Use this when the customer asks 'Is [destination] available?', 'Do you have packages for [destination]?', or similar availability questions. Returns relevant KB entries (FAQ, SOP, DOCUMENT, CUSTOM) whose titles or content mention the query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The destination name, package type, or search phrase to match against knowledge base entries (e.g. 'Maldives', 'Europe honeymoon', 'December packages').",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { query } = args as { query: string };

    try {
      const term = query.toLowerCase().trim();

      // Search KB entries for the department — exclude PRICING (handled by get_pricing)
      const entries = await ctx.db.knowledgeBase.findMany({
        where: {
          departmentId: ctx.departmentId,
          isActive: true,
          type: { not: "PRICING" },
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            { content: { contains: term, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, type: true, title: true, content: true },
      });

      if (entries.length === 0) {
        return {
          success: true,
          data: { results: [] },
          message: `No availability information found for "${query}" in the knowledge base. You can let the customer know you'll check with the team.`,
        };
      }

      const results = entries.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        summary: e.content.length > 400 ? `${e.content.slice(0, 400)}…` : e.content,
      }));

      return {
        success: true,
        data: { results },
        message: `Found ${entries.length} availability entry(ies) matching "${query}".`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error checking availability.";
      return { success: false, message };
    }
  },
};
