/**
 * src/lib/meta-subscriptions.ts
 *
 * T51 — Helpers for subscribing / unsubscribing a Facebook Page to the
 * leadgen webhook via the Meta Graph API.
 *
 * Called by:
 *  - POST /api/channel-configs/[id]/leadgen  (subscribe)
 *  - DELETE /api/channel-configs/[id]/leadgen (unsubscribe)
 *
 * Environment vars:
 *   META_APP_ID     — Facebook App ID (used to form the subscription URL)
 *   META_APP_SECRET — Facebook App Secret (not used here directly; consumed
 *                     by the webhook handler for HMAC verification)
 *
 * The page access token is supplied per-call from the ChannelConfig row so
 * this module is stateless and easily testable via mocking fetch.
 */

/** Result of a Graph API subscription call. */
export interface SubscriptionResult {
  /** Whether the call succeeded. */
  success: boolean;
  /** Human-readable error message when success is false. */
  error?: string;
}

/** Fields subscribed to when enabling Lead Ads notifications. */
const LEADGEN_FIELDS = "leadgen";

/**
 * Subscribe a Facebook Page to leadgen webhook notifications.
 *
 * Calls: POST /{page-id}/subscribed_apps
 *   ?subscribed_fields=leadgen
 *   &access_token={pageAccessToken}
 *
 * @param pageId          - Facebook Page ID
 * @param pageAccessToken - Page-scoped access token stored in ChannelConfig
 * @returns SubscriptionResult
 */
export async function subscribePageToLeadgen(
  pageId: string,
  pageAccessToken: string,
): Promise<SubscriptionResult> {
  const url =
    `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/subscribed_apps` +
    `?subscribed_fields=${encodeURIComponent(LEADGEN_FIELDS)}` +
    `&access_token=${encodeURIComponent(pageAccessToken)}`;

  try {
    const res = await fetch(url, { method: "POST" });
    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok || data.success === false) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const msg =
        typeof errObj?.message === "string"
          ? errObj.message
          : `Graph API ${res.status}`;
      return { success: false, error: msg };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Unsubscribe a Facebook Page from leadgen webhook notifications.
 *
 * Calls: DELETE /{page-id}/subscribed_apps
 *   ?access_token={pageAccessToken}
 *
 * @param pageId          - Facebook Page ID
 * @param pageAccessToken - Page-scoped access token stored in ChannelConfig
 * @returns SubscriptionResult
 */
export async function unsubscribePageFromLeadgen(
  pageId: string,
  pageAccessToken: string,
): Promise<SubscriptionResult> {
  const url =
    `https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/subscribed_apps` +
    `?access_token=${encodeURIComponent(pageAccessToken)}`;

  try {
    const res = await fetch(url, { method: "DELETE" });
    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok || data.success === false) {
      const errObj = data.error as Record<string, unknown> | undefined;
      const msg =
        typeof errObj?.message === "string"
          ? errObj.message
          : `Graph API ${res.status}`;
      return { success: false, error: msg };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
