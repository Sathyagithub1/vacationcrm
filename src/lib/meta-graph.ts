/**
 * src/lib/meta-graph.ts
 *
 * Thin client for the Meta Graph API — used by the Meta Lead Ads webhook
 * handler (T33) to fetch full lead details after receiving a leadgen
 * notification.
 *
 * Environment: no env vars needed here — the page access token is supplied
 * per-call from the ChannelConfig row.
 *
 * In tests, mock this module via:
 *   vi.mock("@/lib/meta-graph", () => ({ getMetaLead: vi.fn() }))
 */

/** One field/answer pair from a Meta Lead Ad form submission. */
export interface MetaLeadFieldData {
  name: string;
  values: string[];
}

/** Full lead record as returned by the Meta Graph API. */
export interface MetaLead {
  id: string;
  created_time: string;
  form_id: string;
  field_data: MetaLeadFieldData[];
}

/**
 * Fetches a single Meta lead by its `leadgen_id` using the supplied page
 * access token.
 *
 * Throws on non-2xx responses with the HTTP status code and body text so
 * callers can log a useful error.
 */
export async function getMetaLead(
  leadgenId: string,
  accessToken: string,
): Promise<MetaLead> {
  const url =
    `https://graph.facebook.com/v18.0/${encodeURIComponent(leadgenId)}` +
    `?fields=field_data,form_id,created_time` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta Graph API ${res.status}: ${body}`);
  }
  return (await res.json()) as MetaLead;
}
