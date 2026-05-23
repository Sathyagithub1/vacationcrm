import { NextRequest, NextResponse } from "next/server";
import { requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";

const VALID_DIMENSIONS = ["DEPARTMENT", "SOURCE", "AGENT", "STAGE"] as const;
type Dimension = (typeof VALID_DIMENSIONS)[number];

// GET /api/analytics/conversion-stats — return conversion stats filterable by dimension
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("reports:view");

    const { searchParams } = request.nextUrl;
    const dimension = searchParams.get("dimension") as Dimension | null;
    const dimensionValue = searchParams.get("dimensionValue") || "";

    // Build the where clause; always scope to tenant
    const where: Record<string, unknown> = { tenantId: user.tenantId };

    if (dimension) {
      if (!VALID_DIMENSIONS.includes(dimension)) {
        return NextResponse.json(
          { error: `Invalid dimension. Must be one of: ${VALID_DIMENSIONS.join(", ")}` },
          { status: 400 }
        );
      }
      where.dimension = dimension;
    }

    if (dimensionValue) {
      where.dimensionValue = dimensionValue;
    }

    // Dept managers can only view stats for their own department dimension
    if (user.role === "DEPT_MANAGER" && user.departmentId) {
      if (dimension === "DEPARTMENT") {
        // Restrict to their department only
        where.dimensionValue = user.departmentId;
      } else if (!dimension) {
        // Without a filter, only return department-scoped data for their dept
        where.dimension = "DEPARTMENT";
        where.dimensionValue = user.departmentId;
      }
    }

    const stats = await (db.conversionStat as any).findMany({
      where,
      orderBy: { computedAt: "desc" },
    });

    return NextResponse.json({ stats });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("GET /api/analytics/conversion-stats error:", error);
    return NextResponse.json({ error: "Failed to fetch conversion stats" }, { status: 500 });
  }
}
