import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/internal/resolve-tenant?slug=<sub>&domain=<host>
 *
 * Internal-only helper for the subdomain middleware (middleware runs on the Edge
 * runtime and cannot use Prisma directly). Resolves a tenant by slug OR custom
 * domain and returns only { id, slug } — no secrets.
 *
 * DEFAULT-OFF GUARANTEE:
 *   Returns 404 unless MULTI_TENANT_SUBDOMAINS === "true". In the default
 *   deployment this route is inert. It also does NOT participate in auth/data
 *   scoping — it only maps a host to a tenant id for advisory headers.
 */
export async function GET(request: Request) {
  if (process.env.MULTI_TENANT_SUBDOMAINS !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase() || null;
  const domain = searchParams.get("domain")?.trim().toLowerCase() || null;

  if (!slug && !domain) {
    return NextResponse.json({ error: "slug or domain required" }, { status: 400 });
  }

  try {
    const or: Array<Record<string, string>> = [];
    if (slug) or.push({ slug });
    if (domain) or.push({ domain });

    const tenant = await prisma.tenant.findFirst({
      where: { OR: or },
      select: { id: true, slug: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ id: tenant.id, slug: tenant.slug });
  } catch (error) {
    console.error("[resolve-tenant] Error:", error);
    return NextResponse.json({ error: "Resolution failed" }, { status: 500 });
  }
}
