/**
 * GET /api/follow-ups/suggestions
 *
 * Returns AI-suggested follow-ups for the calling user.
 * Logic:
 *   - Leads assigned to the user (AGENT) or within their department (DEPT_MANAGER)
 *   - No follow-up activity in the last 7+ days
 *   - Not in a terminal pipeline stage (converted / lost / dormant)
 *   - Capped at 10 suggestions
 *
 * Requires: follow-ups:view permission (any authenticated role)
 */

import { NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
} from "@/modules/auth/tenant.middleware";

const TERMINAL_STAGE_SLUGS = ["converted", "lost", "dormant"];

interface SuggestionResult {
  id: string;
  leadId: string;
  leadName: string;
  daysSinceLastActivity: number;
  suggestedType: "REMINDER" | "RE_ENGAGE";
  type: "REMINDER" | "RE_ENGAGE";
  bestTime: string;
  suggestedScheduledAt: string;
  draftMessage: string;
  confidence: number;
}

export async function GET() {
  try {
    const { user, db } = await requireAuth();

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Resolve terminal stage IDs for this tenant
    const terminalStages = await db.pipelineStage.findMany({
      where: {
        slug: { in: TERMINAL_STAGE_SLUGS },
      },
      select: { id: true },
    });
    const terminalStageIds = terminalStages.map((s) => s.id);

    // Build the lead filter based on role
    const leadWhere: Record<string, unknown> = {
      stageId: { notIn: terminalStageIds },
    };

    if (user.role === "AGENT") {
      // Agents only see their own leads
      leadWhere.assignedTo = user.id;
    } else if (user.role === "DEPT_MANAGER" && user.departmentId) {
      // Dept managers see all leads in their department
      leadWhere.departmentId = user.departmentId;
    }
    // COMPANY_ADMIN / SUPER_ADMIN / VIEWER see all tenant leads (no extra filter)

    // Find leads that have no follow-up or activity in the last 7+ days
    const candidateLeads = await db.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        createdAt: true,
        customer: { select: { name: true } },
        followUps: {
          orderBy: { scheduledAt: "desc" },
          take: 1,
          select: { scheduledAt: true, status: true },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { updatedAt: "asc" },
      take: 50, // Over-fetch so we can filter down to 10
    });

    const suggestions: SuggestionResult[] = [];

    for (const lead of candidateLeads) {
      // Determine last meaningful activity date
      const lastFollowUpDate = lead.followUps[0]?.scheduledAt ?? null;
      const lastActivityDate = lead.activities[0]?.createdAt ?? null;

      const dates: Date[] = [lead.createdAt];
      if (lastFollowUpDate) dates.push(new Date(lastFollowUpDate));
      if (lastActivityDate) dates.push(new Date(lastActivityDate));

      const mostRecentDate = dates.reduce((a, b) => (a > b ? a : b));
      const daysSince = Math.floor((now.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24));

      // Only suggest if inactive for 7+ days
      if (daysSince < 7) continue;

      // Suggest RE_ENGAGE for leads inactive 21+ days, else REMINDER
      const suggestedType: "REMINDER" | "RE_ENGAGE" = daysSince >= 21 ? "RE_ENGAGE" : "REMINDER";

      // Schedule follow-up for next business day (tomorrow 10:00 AM)
      const suggestedDate = new Date(now);
      suggestedDate.setDate(suggestedDate.getDate() + 1);
      suggestedDate.setHours(10, 0, 0, 0);
      // Skip to Monday if it lands on a weekend
      if (suggestedDate.getDay() === 6) suggestedDate.setDate(suggestedDate.getDate() + 2);
      if (suggestedDate.getDay() === 0) suggestedDate.setDate(suggestedDate.getDate() + 1);

      // Confidence score: higher for shorter inactivity gaps (max 90%, min 50%)
      const confidence = Math.max(50, Math.min(90, Math.round(90 - daysSince * 0.5)));

      // Draft message varies by type
      const draftMessage = suggestedType === "RE_ENGAGE"
        ? `Hi ${lead.customer.name}, it has been a while since we last connected. We would love to help you with your travel plans — are you still interested?`
        : `Hi ${lead.customer.name}, just following up on your recent inquiry. Can we assist you further or answer any questions?`;

      suggestions.push({
        id: `${lead.id}-suggestion`,
        leadId: lead.id,
        leadName: lead.customer.name,
        daysSinceLastActivity: daysSince,
        suggestedType,
        type: suggestedType,
        bestTime: suggestedDate.toISOString(),
        suggestedScheduledAt: suggestedDate.toISOString(),
        draftMessage,
        confidence,
      });

      if (suggestions.length >= 10) break;
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/follow-ups/suggestions error:", error);
    return NextResponse.json({ error: "Failed to fetch follow-up suggestions" }, { status: 500 });
  }
}
