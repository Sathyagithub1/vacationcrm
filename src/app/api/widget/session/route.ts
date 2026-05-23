import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantPrisma } from "@/lib/prisma";
import { getOrCreateVisitor } from "@/modules/widget/visitor.service";
import { createVisitorToken } from "@/modules/widget/widget-auth.service";

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
    const widgetConfig = await db.widgetConfig.findFirst({
      where: { departmentId: department.id, isActive: true },
      select: { id: true },
    });
    if (!widgetConfig) {
      return NextResponse.json({ error: "Widget not active for this department" }, { status: 404 });
    }

    // Get or create visitor record
    const visitor = await getOrCreateVisitor(db, visitorId.trim(), {
      pageUrl: pageUrl ?? undefined,
      referrer: referrer ?? undefined,
      userAgent: userAgent ?? undefined,
    });

    // Find an existing ACTIVE WEBSITE conversation for this visitor,
    // or open a new one scoped to the department's widget.
    const customerId = visitor.customerId ?? undefined;

    let conversation = await db.conversation.findFirst({
      where: {
        channel: "WEBSITE",
        status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] },
        ...(customerId ? { customerId } : {}),
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });

    if (!conversation) {
      conversation = await (db.conversation.create as Function)({
        data: {
          channel: "WEBSITE",
          status: "ACTIVE",
          ...(customerId ? { customerId } : {}),
          startedAt: new Date(),
        },
        select: { id: true },
      });
    }

    const visitorToken = createVisitorToken(tenant.id, visitorId.trim());

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
