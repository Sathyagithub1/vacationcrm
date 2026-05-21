import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tenants/public — Public branding endpoint (no auth required).
 * Returns only non-sensitive tenant branding data for login/auth pages.
 * Uses the first active tenant (single-tenant deployment).
 */
export async function GET() {
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { subscriptionStatus: "ACTIVE" },
      select: {
        name: true,
        productName: true,
        logoUrl: true,
        themeConfig: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!tenant) {
      return NextResponse.json({
        tenant: { name: "CRM", productName: "CRM", logoUrl: null, themeConfig: null },
      });
    }

    return NextResponse.json({ tenant });
  } catch (error) {
    console.error("[Tenants Public] Error:", error);
    return NextResponse.json({
      tenant: { name: "CRM", productName: "CRM", logoUrl: null, themeConfig: null },
    });
  }
}
