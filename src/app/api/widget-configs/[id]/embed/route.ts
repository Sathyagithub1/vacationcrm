import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/widget-configs/[id]/embed
 *
 * Admin: generate the copy-paste embed code snippet for a WidgetConfig.
 * Returns the HTML <script> snippet the tenant pastes into their website.
 *
 * The snippet sets window.__hdWidget config and loads the widget loader
 * from /widget-loader.js (the embeddable script served by Next.js public/).
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { user, db } = await requirePermission("settings:widget");

    const config = await db.widgetConfig.findFirst({
      where: { id },
      select: {
        id: true,
        isActive: true,
        position: true,
        department: { select: { slug: true } },
      },
    });

    if (!config) {
      return NextResponse.json({ error: "Widget config not found" }, { status: 404 });
    }

    // Resolve tenant slug for the embed URL
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-crm-domain.com";
    const tenantSlug = tenant.slug;
    const deptSlug = config.department.slug;

    const embedCode = `<!-- Holiday Delight CRM Chat Widget -->
<script>
  window.__hdWidget = {
    tenant: "${tenantSlug}",
    dept:   "${deptSlug}",
    config: "${id}"
  };
  (function(d, s) {
    var js = d.createElement(s);
    js.async = true;
    js.src = "${baseUrl}/widget-loader.js";
    d.head.appendChild(js);
  })(document, "script");
</script>
<!-- End Holiday Delight CRM Chat Widget -->`;

    return NextResponse.json({
      embedCode,
      meta: {
        widgetConfigId: id,
        tenantSlug,
        deptSlug,
        isActive: config.isActive,
        chatUrl: `${baseUrl}/widget/chat?tenant=${tenantSlug}&dept=${deptSlug}`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/widget-configs/[id]/embed error:", error);
    return NextResponse.json({ error: "Failed to generate embed code" }, { status: 500 });
  }
}
