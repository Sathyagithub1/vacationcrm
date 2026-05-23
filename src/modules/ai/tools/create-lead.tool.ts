import { createLead } from "@/modules/leads/leads.service";
import type { AITool, ToolContext, ToolResult } from "./tool.interface";

export const createLeadTool: AITool = {
  definition: {
    name: "create_lead",
    description:
      "Creates a new lead in the CRM when a customer shares their travel interest along with contact information (name and mobile number). Use this tool as soon as you have the customer's name, phone number, and at least one piece of travel intent (destination, travel date, or number of passengers). Source is always WEBSITE for bot-initiated leads.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Full name of the customer as they provided it.",
        },
        customerMobile: {
          type: "string",
          description:
            "Customer's mobile/phone number including country code if available (e.g. +919876543210).",
        },
        customerEmail: {
          type: "string",
          description: "Customer's email address (optional).",
        },
        destination: {
          type: "string",
          description:
            "The travel destination the customer is interested in (e.g. 'Maldives', 'Europe', 'Rajasthan').",
        },
        travelDate: {
          type: "string",
          description:
            "Preferred travel date in ISO 8601 format (YYYY-MM-DD). Derive from the customer's message if they mention a month or timeframe.",
        },
        numPassengers: {
          type: "number",
          description: "Number of travellers / passengers.",
        },
        specialRequirement: {
          type: "string",
          description:
            "Any special requirements or notes the customer mentioned (honeymoon package, wheelchair access, vegan meals, etc.).",
        },
        priority: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "VIP"],
          description:
            "Lead priority. Default to MEDIUM unless the customer signals urgency (HIGH) or VIP status (VIP).",
        },
        isFutureInterest: {
          type: "boolean",
          description:
            "Set to true when the customer is exploring future travel rather than booking imminently.",
        },
      },
      required: ["customerName", "customerMobile"],
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const {
      customerName,
      customerMobile,
      customerEmail,
      destination,
      travelDate,
      numPassengers,
      specialRequirement,
      priority,
      isFutureInterest,
    } = args as {
      customerName: string;
      customerMobile: string;
      customerEmail?: string;
      destination?: string;
      travelDate?: string;
      numPassengers?: number;
      specialRequirement?: string;
      priority?: string;
      isFutureInterest?: boolean;
    };

    try {
      const lead = await createLead(
        ctx.db,
        {
          customerName,
          customerMobile,
          customerEmail: customerEmail ?? null,
          departmentId: ctx.departmentId,
          tenantId: ctx.tenantId,
          destination: destination ?? null,
          travelDate: travelDate ?? null,
          numPassengers: numPassengers ?? null,
          specialRequirement: specialRequirement ?? null,
          source: "WEBSITE",
          priority: priority ?? "MEDIUM",
          isFutureInterest: isFutureInterest ?? false,
        },
        // Bot-originated leads use a sentinel system userId; the service accepts
        // any non-null string for the activity log userId field.
        "SYSTEM_BOT",
      );

      // Link the lead back to this conversation so the callback guard works
      await ctx.db.conversation.update({
        where: { id: ctx.conversationId },
        data: { leadId: lead.id },
      });

      return {
        success: true,
        data: {
          leadId: lead.id,
          customerId: lead.customerId,
          destination: lead.destination,
          priority: lead.priority,
        },
        message: `Lead created successfully for ${customerName} (ID: ${lead.id}).`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error creating lead.";
      return { success: false, message };
    }
  },
};
