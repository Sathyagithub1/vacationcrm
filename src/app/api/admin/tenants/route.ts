import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

/**
 * GET /api/admin/tenants — SUPER_ADMIN-only read-only list of all tenants.
 *
 * This is a lightweight, additive admin view for the multi-tenant SaaS. It does
 * NOT switch tenants and does NOT modify the NextAuth session — live
 * session-based tenant switching is DEFERRED (see task notes) because it would
 * require changing auth-options JWT/session resolution, which is risky on the
 * live single-tenant auth flow. This endpoint only reads.
 *
 * Returns non-sensitive fields only. Never exposes credentials/secrets.
 */
export async function GET() {
  try {
    const { user } = await requireAuth();

    if (user.role !== "SUPER_ADMIN") {
      return forbidden();
    }

    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        productName: true,
        subscriptionStatus: true,
        plan: true,
        createdAt: true,
        _count: { select: { users: true, leads: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ tenants });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("[Admin Tenants] Error:", error);
    return NextResponse.json({ error: "Failed to list tenants" }, { status: 500 });
  }
}
