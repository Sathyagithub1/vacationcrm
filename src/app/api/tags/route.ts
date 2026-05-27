/**
 * src/app/api/tags/route.ts
 *
 * T42 — Tags list + create.
 *
 * GET  /api/tags  — list tags, optionally filtered by scope
 * POST /api/tags  — create tag; unique per (tenantId, name, scope)
 *
 * TagScope enum: CUSTOMER | LEAD | BOTH
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";

const VALID_SCOPES = new Set(["CUSTOMER", "LEAD", "BOTH"]);

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await requireAuth();

    // All roles can view tags (used for lead/customer tagging everywhere)
    const { searchParams } = request.nextUrl;
    const scope = searchParams.get("scope") ?? undefined;

    const where: Record<string, unknown> = {};
    if (scope && VALID_SCOPES.has(scope)) where.scope = scope;

    const tags = await db.tag.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ tags });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") return unauthorized();
    return NextResponse.json({ error: "Failed to fetch tags" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:integrations");

    const body = (await request.json()) as Record<string, unknown>;

    const name  = typeof body.name  === "string" ? body.name.trim()  : null;
    const scope = typeof body.scope === "string" ? body.scope.toUpperCase() : null;
    const color = typeof body.color === "string" ? body.color : null;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (!scope || !VALID_SCOPES.has(scope)) {
      return NextResponse.json(
        { error: `scope must be one of: ${[...VALID_SCOPES].join(", ")}` },
        { status: 400 },
      );
    }

    const tag = await db.tag.create({
      data: {
        tenantId: user.tenantId,
        name,
        scope: scope as never,
        color,
      },
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "Unauthorized") return unauthorized();
      if (err.message === "Forbidden")    return forbidden();
      if ("code" in err && (err as Record<string, unknown>).code === "P2002") {
        return NextResponse.json(
          { error: "Tag with this name and scope already exists for this tenant" },
          { status: 409 },
        );
      }
    }
    console.error("POST /api/tags error:", err);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}
