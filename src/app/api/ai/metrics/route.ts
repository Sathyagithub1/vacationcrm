import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

// GET /api/ai/metrics — aggregate AI usage metrics for this tenant
export async function GET(_request: NextRequest) {
  try {
    const { db } = await requirePermission("ai:metrics");

    // Run all three aggregations in parallel for efficiency.
    // handoffCount: conversations where handoffReason was set (i.e. escalated).
    const [aggregate, handoffCount, totalConversations] = await Promise.all([
      db.aIConversation.aggregate({
        _sum: {
          totalTokens: true,
          totalCost: true,
        },
      }),
      db.aIConversation.count({
        where: { handoffReason: { not: null } },
      }),
      db.aIConversation.count(),
    ]);

    const totalTokens = aggregate._sum.totalTokens ?? 0;
    const totalCostUsd = aggregate._sum.totalCost ?? 0;
    const handoffRate =
      totalConversations > 0
        ? Math.round((handoffCount / totalConversations) * 10000) / 100 // two decimal places as percentage
        : 0;

    return NextResponse.json({
      metrics: {
        totalConversations,
        totalTokens,
        totalCostUsd:
          typeof totalCostUsd === "number"
            ? Math.round(totalCostUsd * 1000000) / 1000000 // 6 decimal precision
            : 0,
        handoffCount,
        handoffRate, // percentage, e.g. 12.50 means 12.50%
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("GET /api/ai/metrics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI metrics" },
      { status: 500 }
    );
  }
}
