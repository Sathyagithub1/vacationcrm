import { NextRequest, NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/modules/auth/tenant.middleware";
import {
  getLeadFunnel,
  getDepartmentPerformance,
  getAgentPerformance,
  getSourceAnalysis,
  getFollowUpEffectiveness,
  getTimeTrends,
  generateCSV,
} from "@/modules/analytics/reports.service";

const VALID_TYPES = [
  "lead-funnel",
  "department-performance",
  "agent-performance",
  "source-analysis",
  "follow-up-effectiveness",
  "time-trends",
];

// GET /api/reports?type=...&dateFrom=...&dateTo=...&departmentId=...&format=json|csv
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { searchParams } = request.nextUrl;

    const type = searchParams.get("type");
    const dateFrom = searchParams.get("dateFrom") || undefined;
    const dateTo = searchParams.get("dateTo") || undefined;
    const departmentId = searchParams.get("departmentId") || undefined;
    const format = searchParams.get("format") || "json";
    const granularity = searchParams.get("granularity") || "daily";

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid report type. Valid types: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const filters = {
      tenantId: user.tenantId,
      dateFrom,
      dateTo,
      departmentId,
    };

    let data: { rows: Record<string, unknown>[]; summary?: Record<string, unknown>; granularity?: string };

    switch (type) {
      case "lead-funnel":
        data = await getLeadFunnel(filters);
        break;
      case "department-performance":
        data = await getDepartmentPerformance(filters);
        break;
      case "agent-performance":
        data = await getAgentPerformance(filters);
        break;
      case "source-analysis":
        data = await getSourceAnalysis(filters);
        break;
      case "follow-up-effectiveness":
        data = await getFollowUpEffectiveness(filters);
        break;
      case "time-trends":
        data = await getTimeTrends({ ...filters, granularity });
        break;
      default:
        return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
    }

    // CSV export
    if (format === "csv") {
      if (!data.rows || data.rows.length === 0) {
        return new NextResponse("No data", {
          status: 200,
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="${type}-report.csv"`,
          },
        });
      }

      const headers = Object.keys(data.rows[0]);
      const csv = generateCSV(headers, data.rows);

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${type}-report.csv"`,
        },
      });
    }

    return NextResponse.json({ type, ...data });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    console.error("Reports error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
