import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantPrisma } from "@/lib/prisma";
import { getOrCreateVisitor } from "@/modules/widget/visitor.service";
import { createVisitorToken } from "@/modules/widget/widget-auth.service";
import { createNotification } from "@/modules/notifications/notification.service";

/**
 * POST /api/widget/session
 *
 * PUBLIC — no NextAuth session required.
 * Body: { tenantSlug, deptSlug, visitorId, pageUrl?, referrer?, userAgent? }
 *
 * Creates or resumes a visitor session and returns:
 *   - visitorToken  — short-lived JWT for subsequent widget API calls
 *   - conversationId — active WEBSITE conversation for this visitor
 *   - visitor        — visitor record
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantSlug, deptSlug, visitorId, pageUrl, referrer, userAgent } = body;

    if (!tenantSlug || typeof tenantSlug !== "string" || !tenantSlug.trim()) {
      return NextResponse.json({ error: "tenantSlug is required" }, { status: 400 });
    }
    if (!deptSlug || typeof deptSlug !== "string" || !deptSlug.trim()) {
      return NextResponse.json({ error: "deptSlug is required" }, { status: 400 });
    }
    if (!visitorId || typeof visitorId !== "string" || !visitorId.trim()) {
      return NextResponse.json({ error: "visitorId is required" }, { status: 400 });
    }

    // Resolve tenant
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug.trim() },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const db = tenantPrisma(tenant.id);

    // Resolve department
    const department = await db.department.findFirst({
      where: { slug: deptSlug.trim(), isActive: true },
      select: { id: true },
    });
    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    // Verify widget config is active
    const widgetConfig = await (db as any).widgetConfig.findFirst({
      where: { departmentId: department.id, isActive: true },
      select: { id: true },
    }) as { id: string } | null;
    if (!widgetConfig) {
      return NextResponse.json({ error: "Widget not active for this department" }, { status: 404 });
    }

    // Get or create visitor record
    const visitor = await getOrCreateVisitor(db, visitorId.trim(), {
      pageUrl: pageUrl ?? undefined,
      referrer: referrer ?? undefined,
      userAgent: userAgent ?? undefined,
    });

    // Find an existing ACTIVE WEBSITE conversation for this visitor scoped to this department,
    // or open a new one. We scope by assignedAgentId being set from this widgetConfig's department
    // but the lightest approach is to match on widgetConfigId stored as channel metadata.
    // Since Conversation has no widgetConfigId column, we match existing conversations by
    // (customerId OR unassigned visitor) that are already assigned to an agent in this department.
    const customerId = (visitor as Record<string, unknown>).customerId as string | undefined;

    // Look for an existing open WEBSITE conversation for this visitor in this department.
    // Department agents are used as the scope filter for existing conversations.
    const deptAgentIds = await (db.user.findMany as Function)({
      where: { departmentId: department.id, isActive: true },
      select: { id: true },
    }) as Array<{ id: string }>;
    const deptAgentIdSet = deptAgentIds.map((u: { id: string }) => u.id);

    const existingConversation = await (db.conversation.findFirst as Function)({
      where: {
        channel: "WEBSITE",
        status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] },
        ...(customerId ? { customerId } : {}),
        ...(deptAgentIdSet.length > 0 ? { assignedAgentId: { in: deptAgentIdSet } } : {}),
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, assignedAgentId: true },
    }) as { id: string; assignedAgentId: string | null } | null;

    let assignedAgentId: string | null = existingConversation?.assignedAgentId ?? null;

    // Auto-assign to least-loaded active agent in this department when creating a new conversation
    if (!existingConversation) {
      // Resolve least-loaded agent: AGENT role first, fall back to DEPT_MANAGER, then COMPANY_ADMIN
      type AgentRow = { id: string; role: string; _count?: { conversations: number } };

      const candidates = await (db.user.findMany as Function)({
        where: { departmentId: department.id, isActive: true, role: { in: ["AGENT", "DEPT_MANAGER"] } },
        select: { id: true, role: true },
      }) as AgentRow[];

      if (candidates.length === 0) {
        // Fall back to any COMPANY_ADMIN for this tenant
        const admins = await (db.user.findMany as Function)({
          where: { role: "COMPANY_ADMIN", isActive: true },
          select: { id: true, role: true },
          take: 1,
        }) as AgentRow[];
        if (admins.length > 0) candidates.push(...admins);
      }

      if (candidates.length > 0) {
        // Pick least-loaded: count their open WEBSITE conversations
        type LoadRow = { assignedAgentId: string; _count: { id: number } };
        const loadCounts = await (db.conversation.groupBy as Function)({
          by: ["assignedAgentId"],
          where: {
            assignedAgentId: { in: candidates.map((c: AgentRow) => c.id) },
            status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] },
          },
          _count: { id: true },
        }) as LoadRow[];

        const loadMap = new Map<string, number>(
          loadCounts.map((row: LoadRow) => [row.assignedAgentId, row._count.id])
        );

        // Sort AGENT role before DEPT_MANAGER, then by load ascending
        const sorted = [...candidates].sort((a: AgentRow, b: AgentRow) => {
          const roleOrder = (r: string) => (r === "AGENT" ? 0 : r === "DEPT_MANAGER" ? 1 : 2);
          const roleDiff = roleOrder(a.role) - roleOrder(b.role);
          if (roleDiff !== 0) return roleDiff;
          return (loadMap.get(a.id) ?? 0) - (loadMap.get(b.id) ?? 0);
        });

        assignedAgentId = sorted[0].id;
      }
    }

    const conversation = existingConversation ?? (await (db.conversation.create as Function)({
      data: {
        channel: "WEBSITE",
        status: "ACTIVE",
        ...(customerId ? { customerId } : {}),
        ...(assignedAgentId ? { assignedAgentId } : {}),
        startedAt: new Date(),
      },
      select: { id: true, assignedAgentId: true },
    }) as { id: string; assignedAgentId: string | null });

    // Fire NEW_MESSAGE notification to the assigned agent so they know a visitor started chatting
    if (assignedAgentId && !existingConversation) {
      createNotification({
        tenantId: tenant.id,
        userId: assignedAgentId,
        type: "NEW_MESSAGE",
        title: "New visitor chat started",
        body: "A visitor has opened a new chat session and is waiting for a response.",
        data: { conversationId: conversation.id, widgetConfigId: widgetConfig.id, departmentId: department.id },
      }).catch((err) => console.error("[Widget] Failed to send new-chat notification:", err));
    }

    const visitorToken = createVisitorToken(tenant.id, visitorId.trim(), widgetConfig.id);

    return NextResponse.json({
      visitorToken,
      conversationId: conversation.id,
      visitor: {
        id: visitor.id,
        visitorId: visitor.visitorId,
        totalVisits: visitor.totalVisits,
        totalMessages: visitor.totalMessages,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
      },
    });
  } catch (error) {
    console.error("POST /api/widget/session error:", error);
    return NextResponse.json({ error: "Failed to create widget session" }, { status: 500 });
  }
}
