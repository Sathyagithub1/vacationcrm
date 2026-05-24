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

    const config = await (db as any).widgetConfig.findFirst({
      where: { id },
      select: {
        id: true,
        isActive: true,
        position: true,
        themeOverride: true,
        department: { select: { slug: true } },
      },
    }) as { id: string; isActive: boolean; position: string; themeOverride: Record<string, unknown> | null; department: { slug: string } } | null;

    if (!config) {
      return NextResponse.json({ error: "Widget config not found" }, { status: 404 });
    }

    // Resolve tenant slug, product name, and theme color for the embed snippet
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true, productName: true, themeConfig: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Server misconfigured — NEXT_PUBLIC_APP_URL or NEXTAUTH_URL must be set to generate embed code" },
        { status: 500 }
      );
    }
    const tenantSlug = tenant.slug;
    const deptSlug = config.department.slug;
    const productName = tenant.productName;

    // Resolve theme color: prefer widget themeOverride, then tenant themeConfig, then brand default
    const themeOverride = config.themeOverride as Record<string, unknown> | null;
    const tenantTheme = tenant.themeConfig as Record<string, unknown> | null;
    const primaryColor: string =
      (typeof themeOverride?.primaryColor === "string" ? themeOverride.primaryColor : null) ??
      (typeof tenantTheme?.primaryColor === "string" ? tenantTheme.primaryColor : null) ??
      "#FF6B35";

    const embedCode = `<!-- ${productName} Chat Widget -->
<script src="${baseUrl}/widget.js"
  data-tenant="${tenantSlug}"
  data-dept="${deptSlug}"
  data-config="${id}"
  data-theme="${primaryColor}"
  data-product-name="${productName}"
  async></script>
<!-- End ${productName} Chat Widget -->`;

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
