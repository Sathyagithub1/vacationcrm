/**
 * src/app/api/tours/import/route.ts
 *
 * Phase 6m — Bulk tour import.
 *
 * POST /api/tours/import
 *   Body: { tours: RawRow[] }  (client parses the CSV into rows)
 *   RawRow: { code, name, description?, department?/departmentId?, startDate,
 *             endDate, capacity, status? }
 *
 * Each row is validated and created independently — one bad row never blocks the
 * others. Returns a per-row result so the UI can show exactly what imported and
 * what failed and why (no silent partial import).
 *
 * Department is resolved by name (case-insensitive) or explicit departmentId.
 * If a row omits the department and the tenant has exactly one, it's used.
 *
 * Auth: requires "settings:integrations" (same as single tour create).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

const MAX_ROWS = 500;
const VALID_STATUS = ["ACTIVE", "SOLD_OUT", "ARCHIVED"];

interface RowResult {
  row: number;
  code: string;
  ok: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json().catch(() => ({}))) as { tours?: unknown };
    const rows = Array.isArray(body.tours) ? (body.tours as Record<string, unknown>[]) : null;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No rows to import." }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${rows.length}). Import at most ${MAX_ROWS} at a time.` },
        { status: 400 },
      );
    }

    // Load tenant departments once for name/id resolution.
    const departments = await db.department.findMany({ select: { id: true, name: true } });
    const byId = new Map(departments.map((d) => [d.id, d]));
    const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d]));
    const soleDept = departments.length === 1 ? departments[0] : null;

    const results: RowResult[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 1;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
      const code = str(r.code);
      const name = str(r.name);

      try {
        if (!code || !name) {
          throw new Error("code and name are required");
        }

        // Resolve department
        let departmentId: string | undefined;
        const rawDeptId = str(r.departmentId);
        const rawDeptName = str(r.department);
        if (rawDeptId) {
          if (!byId.has(rawDeptId)) throw new Error(`Unknown departmentId "${rawDeptId}"`);
          departmentId = rawDeptId;
        } else if (rawDeptName) {
          const match = byName.get(rawDeptName.toLowerCase());
          if (!match) throw new Error(`Unknown department "${rawDeptName}"`);
          departmentId = match.id;
        } else if (soleDept) {
          departmentId = soleDept.id;
        } else {
          throw new Error("department is required (multiple departments exist)");
        }

        // Dates
        const startStr = str(r.startDate);
        const endStr = str(r.endDate);
        if (!startStr || !endStr) throw new Error("startDate and endDate are required (YYYY-MM-DD)");
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error("startDate/endDate must be valid dates (YYYY-MM-DD)");
        }
        if (endDate < startDate) throw new Error("endDate is before startDate");

        // Capacity
        const capNum =
          typeof r.capacity === "number" ? r.capacity : parseInt(str(r.capacity), 10);
        if (!Number.isFinite(capNum) || capNum < 1) {
          throw new Error("capacity must be a whole number ≥ 1");
        }

        // Status
        const statusRaw = str(r.status).toUpperCase();
        const status = statusRaw || "ACTIVE";
        if (!VALID_STATUS.includes(status)) {
          throw new Error(`status must be one of ${VALID_STATUS.join(", ")}`);
        }

        await db.tour.create({
          data: {
            tenantId: user.tenantId,
            code,
            name,
            description: str(r.description) || null,
            departmentId,
            startDate,
            endDate,
            capacity: Math.floor(capNum),
            status: status as never,
          },
        });

        created++;
        results.push({ row: rowNum, code, ok: true });
      } catch (err: unknown) {
        let message = err instanceof Error ? err.message : String(err);
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          message = `Tour code "${code}" already exists`;
        }
        results.push({ row: rowNum, code, ok: false, error: message });
      }
    }

    return NextResponse.json({
      created,
      failed: rows.length - created,
      total: rows.length,
      results,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/tours/import error:", err);
    return NextResponse.json({ error: "Failed to import tours" }, { status: 500 });
  }
}
