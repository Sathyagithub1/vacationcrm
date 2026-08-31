import { NextResponse, type NextRequest } from "next/server";

/**
 * src/middleware.ts — Subdomain / host-based tenant resolution (multi-tenant SaaS).
 *
 * DEFAULT-OFF GUARANTEE:
 *   This middleware is a COMPLETE NO-OP unless MULTI_TENANT_SUBDOMAINS === "true".
 *   The app had NO middleware before this file, so with the flag unset (the
 *   default) every request passes straight through via NextResponse.next() with
 *   no headers added and no rewrites — behavior is identical to having no
 *   middleware at all.
 *
 *   When the flag is ON, it resolves a tenant from the Host header and attaches
 *   x-tenant-id / x-tenant-slug request headers as ADDITIVE METADATA for
 *   downstream handlers that opt in. It does NOT change how authenticated
 *   requests resolve their tenant — the NextAuth session JWT (user.tenantId)
 *   remains the sole source of truth for data scoping (see auth-options.ts and
 *   tenant.middleware.ts). The header is advisory only.
 *
 * NOTE: middleware runs on the Edge runtime and cannot use Prisma directly, so
 * tenant lookup is delegated to an internal API route (/api/internal/resolve-tenant)
 * which is itself flag-gated. If resolution fails for any reason, we fall through
 * (NextResponse.next()) — resolution NEVER blocks a request.
 */

const FLAG_ON = process.env.MULTI_TENANT_SUBDOMAINS === "true";

export async function middleware(request: NextRequest) {
  // Flag OFF (default): behave exactly as if no middleware existed.
  if (!FLAG_ON) {
    return NextResponse.next();
  }

  const host = request.headers.get("host") ?? "";
  // Strip port; lowercase for consistent matching.
  const hostname = host.split(":")[0].toLowerCase();

  // Derive a candidate subdomain slug (e.g. "acme" from "acme.example.com").
  // The root/base domain is configurable; when a request has no subdomain we
  // simply pass through with no header.
  const baseDomain = (process.env.MULTI_TENANT_BASE_DOMAIN ?? "").toLowerCase();
  let slugCandidate = "";
  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    slugCandidate = hostname.slice(0, -(baseDomain.length + 1));
    // Ignore common non-tenant subdomains.
    if (slugCandidate === "www" || slugCandidate === "app" || slugCandidate === "") {
      slugCandidate = "";
    }
  }

  try {
    // Resolve by subdomain slug OR by full custom domain (Tenant.domain).
    const url = new URL("/api/internal/resolve-tenant", request.url);
    if (slugCandidate) url.searchParams.set("slug", slugCandidate);
    url.searchParams.set("domain", hostname);

    const res = await fetch(url, {
      headers: { "x-internal-resolve": "1" },
      // Never let tenant resolution hang a request.
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string; slug?: string } | null;
      if (data?.id) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-tenant-id", data.id);
        if (data.slug) requestHeaders.set("x-tenant-slug", data.slug);
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
    }
  } catch {
    // Resolution failed — do not block; fall through.
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and Next internals; only run on app + API routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js)$).*)"],
};
