/**
 * Shared utility for fetching public tenant branding on auth pages.
 */
export interface PublicTenantBranding {
  name: string;
  productName: string;
  logoUrl: string | null;
  themeConfig: Record<string, unknown> | null;
}

const FALLBACK: PublicTenantBranding = {
  name: "CRM",
  productName: "CRM",
  logoUrl: null,
  themeConfig: null,
};

export async function fetchPublicBranding(): Promise<PublicTenantBranding> {
  try {
    const res = await fetch("/api/tenants/public");
    if (!res.ok) return FALLBACK;
    const { tenant } = await res.json();
    return tenant ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** Derive initials from a tenant name (first letter of each word, max 2 chars). */
export function tenantInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
