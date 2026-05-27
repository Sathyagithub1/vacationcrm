/**
 * src/app/snippet/[tenantToken]/route.ts
 *
 * T49 — JavaScript snippet delivery endpoint.
 *
 * GET /snippet/:tenantToken
 *
 * Returns a tenant-specific JavaScript IIFE that tenants paste into their
 * website via a single <script> tag.  The snippet auto-discovers all forms on
 * the page and POSTs submissions to the CRM intake webhook.
 *
 * Responses:
 *   200  text/javascript — the snippet (public, cacheable for 5 minutes)
 *   404  text/javascript — "// Unknown tenant" comment (still valid JS)
 *
 * Environment vars:
 *   PUBLIC_BASE_URL — CRM origin used inside the snippet; falls back to the
 *                     request's own origin when not set.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSnippet } from "@/lib/snippet/template";

type RouteContext = { params: Promise<{ tenantToken: string }> };

/**
 * GET /snippet/[tenantToken]
 *
 * Serves the tenant-specific JavaScript snippet.
 */
export async function GET(
  req: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { tenantToken } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { intakeToken: tenantToken },
    select: { id: true },
  });

  if (!tenant) {
    return new NextResponse("// Unknown tenant", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  const baseUrl = process.env.PUBLIC_BASE_URL ?? req.nextUrl.origin;

  return new NextResponse(buildSnippet(tenantToken, baseUrl), {
    status: 200,
    headers: {
      "Content-Type":  "application/javascript",
      "Cache-Control": "public, max-age=300",
    },
  });
}
