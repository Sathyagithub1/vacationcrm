/**
 * POST /api/broadcasts/preview
 *
 * Preview the audience for a tag-based broadcast before sending.
 * Returns count + up to 5 sample customers.
 *
 * Body: { tagIds: string[], scope?: "CUSTOMER" | "LEAD" }
 *
 * Requires: broadcasts:send permission
 */

import { NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { previewAudience, type AudienceScope } from "@/modules/broadcast/audience";

const VALID_SCOPES: AudienceScope[] = ["CUSTOMER", "LEAD"];

export async function POST(request: Request) {
  try {
    const { user } = await requirePermission("broadcasts:send");

    const body = (await request.json()) as Record<string, unknown>;
    const { tagIds, scope } = body;

    if (!Array.isArray(tagIds) || tagIds.some((t) => typeof t !== "string")) {
      return NextResponse.json(
        { error: "tagIds must be a non-empty array of strings" },
        { status: 400 }
      );
    }

    const audienceScope: AudienceScope =
      typeof scope === "string" && VALID_SCOPES.includes(scope as AudienceScope)
        ? (scope as AudienceScope)
        : "CUSTOMER";

    const preview = await previewAudience(user.tenantId, tagIds as string[], audienceScope);

    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("POST /api/broadcasts/preview error:", error);
    return NextResponse.json({ error: "Failed to preview audience" }, { status: 500 });
  }
}
