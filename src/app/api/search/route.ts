import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import { globalSearch } from "@/lib/search";

/**
 * GET /api/search?q=term
 * Global search across customers, leads, and conversations.
 * Tenant-scoped. Returns max 5 results per category.
 */
export async function GET(request: NextRequest) {
  try {
    const { db } = await requireAuth();
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";

    if (!q || q.length < 2) {
      return NextResponse.json({
        customers: [],
        leads: [],
        conversations: [],
      });
    }

    const results = await globalSearch(db, q);
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("[Search] Error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
