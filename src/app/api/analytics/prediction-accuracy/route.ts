import { NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { getPredictionAccuracy } from "@/modules/analytics/prediction.service";

// GET /api/analytics/prediction-accuracy — compare accepted predictions vs outcomes
// Returns overall accuracy percentage and a per-type breakdown
export async function GET(_request: Request) {
  try {
    const { user, db } = await requirePermission("reports:view");

    const accuracy = await getPredictionAccuracy(db, user.tenantId);

    return NextResponse.json({ accuracy });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/analytics/prediction-accuracy error:", error);
    return NextResponse.json({ error: "Failed to fetch prediction accuracy" }, { status: 500 });
  }
}
