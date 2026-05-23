/**
 * GET /api/customers/:id/channels
 *
 * Returns all linked channel identities (CustomerChannel records) for a customer.
 * Credentials are never exposed — this only returns external IDs and metadata.
 *
 * Requires: customers:view permission (via requireAuth — all authenticated roles can view)
 */

import { NextResponse } from "next/server";
import {
  requireAuth,
  unauthorized,
} from "@/modules/auth/tenant.middleware";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db } = await requireAuth();

    // Verify customer belongs to this tenant
    const customer = await db.customer.findFirst({ where: { id } });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const channels = await db.customerChannel.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channel: true,
        externalId: true,
        displayName: true,
        profilePicUrl: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ channels });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("GET /api/customers/:id/channels error:", error);
    return NextResponse.json({ error: "Failed to fetch customer channels" }, { status: 500 });
  }
}
