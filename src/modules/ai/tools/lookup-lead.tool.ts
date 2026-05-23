import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const lookupLeadTool: AITool = {
  definition: {
    name: "lookup_lead",
    description:
      "Looks up an existing customer record by phone number or email address. Returns the customer's profile and their most recent leads. Use this before creating a new lead to avoid duplicates, or when the customer references a previous booking or inquiry.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Customer's mobile/phone number to search by.",
        },
        email: {
          type: "string",
          description: "Customer's email address to search by.",
        },
      },
      // At least one of phone or email must be provided; enforced at runtime
      required: [],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { phone, email } = args as { phone?: string; email?: string };

    if (!phone && !email) {
      return {
        success: false,
        message: "Please provide at least a phone number or email address to look up the customer.",
      };
    }

    try {
      // Build OR conditions based on whichever identifiers were supplied
      const orConditions: Record<string, unknown>[] = [];
      if (phone) orConditions.push({ mobile: phone });
      if (email) orConditions.push({ email });

      const customer = await ctx.db.customer.findFirst({
        where: { OR: orConditions },
        include: {
          leads: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              destination: true,
              travelDate: true,
              numPassengers: true,
              priority: true,
              source: true,
              createdAt: true,
              stage: { select: { name: true, slug: true } },
            },
          },
        },
      });

      if (!customer) {
        return {
          success: true,
          data: { found: false },
          message: "No existing customer found with the provided phone or email.",
        };
      }

      return {
        success: true,
        data: {
          found: true,
          customer: {
            id: customer.id,
            name: customer.name,
            mobile: customer.mobile,
            email: customer.email ?? null,
            totalLeads: customer.totalLeads,
            lastLeadDate: customer.lastLeadDate ?? null,
          },
          recentLeads: customer.leads.map((l) => ({
            id: l.id,
            destination: l.destination ?? null,
            travelDate: l.travelDate ?? null,
            numPassengers: l.numPassengers ?? null,
            priority: l.priority,
            source: l.source,
            stage: l.stage.name,
            createdAt: l.createdAt,
          })),
        },
        message: `Found customer "${customer.name}" with ${customer.leads.length} recent lead(s).`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error during customer lookup.";
      return { success: false, message };
    }
  },
};
