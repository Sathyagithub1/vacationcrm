import { NextRequest, NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

interface WeightInput {
  featureName: string;
  weight: number;
  category: string;
}

const VALID_CATEGORIES = ["engagement", "attributes", "historical", "conversation"] as const;

// GET /api/analytics/scoring-weights — list scoring weights for this tenant
export async function GET(_request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:analytics");

    const weights = await (db.scoringWeight as any).findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ category: "asc" }, { featureName: "asc" }],
    });

    return NextResponse.json({ weights });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/analytics/scoring-weights error:", error);
    return NextResponse.json({ error: "Failed to fetch scoring weights" }, { status: 500 });
  }
}

// PUT /api/analytics/scoring-weights — update weights for this tenant
// Body: [{featureName, weight, category}]
export async function PUT(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:analytics");

    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be an array of weight objects" },
        { status: 400 }
      );
    }

    if (body.length === 0) {
      return NextResponse.json(
        { error: "At least one weight entry is required" },
        { status: 400 }
      );
    }

    // Validate each entry
    for (const item of body as WeightInput[]) {
      if (!item.featureName || typeof item.featureName !== "string" || !item.featureName.trim()) {
        return NextResponse.json(
          { error: "Each weight entry must have a non-empty featureName" },
          { status: 400 }
        );
      }

      if (typeof item.weight !== "number" || item.weight < 0 || item.weight > 1) {
        return NextResponse.json(
          { error: `Weight for "${item.featureName}" must be a number between 0 and 1` },
          { status: 400 }
        );
      }

      if (!item.category || !VALID_CATEGORIES.includes(item.category as (typeof VALID_CATEGORIES)[number])) {
        return NextResponse.json(
          {
            error: `Category for "${item.featureName}" must be one of: ${VALID_CATEGORIES.join(", ")}`,
          },
          { status: 400 }
        );
      }
    }

    // Upsert each weight using the unique constraint (tenantId, featureName)
    const upserted = await Promise.all(
      (body as WeightInput[]).map((item) =>
        (db.scoringWeight as any).upsert({
          where: {
            tenantId_featureName: {
              tenantId: user.tenantId,
              featureName: item.featureName.trim(),
            },
          },
          update: {
            weight: item.weight,
            category: item.category,
            autoTuned: false,
          },
          create: {
            tenantId: user.tenantId,
            featureName: item.featureName.trim(),
            weight: item.weight,
            category: item.category,
            autoTuned: false,
          },
        })
      )
    );

    return NextResponse.json({ weights: upserted, updated: upserted.length });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("PUT /api/analytics/scoring-weights error:", error);
    return NextResponse.json({ error: "Failed to update scoring weights" }, { status: 500 });
  }
}
