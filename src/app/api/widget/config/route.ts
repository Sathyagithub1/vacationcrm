import { NextRequest, NextResponse } from "next/server";
import { getWidgetConfig } from "@/modules/widget/widget.service";

/**
 * GET /api/widget/config?tenant=<slug>&dept=<slug>
 *
 * PUBLIC — no NextAuth session required.
 * Returns the WidgetConfig for the given tenant + department slugs,
 * plus the tenant's branding fields needed to render the chat iframe.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tenantSlug = searchParams.get("tenant")?.trim();
    const deptSlug = searchParams.get("dept")?.trim();

    if (!tenantSlug || !deptSlug) {
      return NextResponse.json(
        { error: "tenant and dept query parameters are required" },
        { status: 400 }
      );
    }

    const config = await getWidgetConfig(tenantSlug, deptSlug);

    if (!config) {
      return NextResponse.json(
        { error: "Widget configuration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error("GET /api/widget/config error:", error);
    return NextResponse.json({ error: "Failed to fetch widget config" }, { status: 500 });
  }
}
