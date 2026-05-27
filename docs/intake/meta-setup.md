# Meta Lead Ads — Platform Admin Setup Guide

This is a **one-time setup** performed by the platform administrator.
Tenants connect their own Facebook Pages separately (see tenant docs).

---

## Overview

When a tenant runs a Facebook Lead Ad, Meta sends a webhook notification to
the CRM.  The CRM then fetches the full lead using the page access token and
runs the intake pipeline.

The integration has two layers:

| Layer | Who sets it up | What it does |
|-------|---------------|--------------|
| Meta App (platform-level) | Platform admin | Receives webhook events from all pages |
| Per-page subscription | Tenant admin | Routes events for a specific page to the CRM |

---

## Step 1 — Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) and sign in.
2. Click **My Apps → Create App**.
3. Select **Business** as the app type.
4. Fill in the app name and contact email; click **Create App**.
5. On the app dashboard, note:
   - **App ID** — copy it
   - **App Secret** — click **Show** and copy it

![Step 1 — Meta App dashboard](./img/meta-step-1.png)

---

## Step 2 — Set environment variables

Add these to your `.env.local` (or production secrets manager):

```bash
META_APP_ID=<your-app-id>
META_APP_SECRET=<your-app-secret>
META_VERIFY_TOKEN=<random-string-you-choose>
```

`META_VERIFY_TOKEN` is a random string you generate yourself — it is used to
verify Meta's subscription challenge during webhook registration.  Use any
strong random value (e.g. `openssl rand -hex 24`).

---

## Step 3 — Configure the Webhooks product

1. On the Meta App dashboard, click **Add Product** → **Webhooks** → **Set Up**.
2. Select **Page** as the object type.
3. Click **Subscribe to this object** and fill in:

   | Field | Value |
   |-------|-------|
   | Callback URL | `https://YOUR_DOMAIN/api/webhooks/meta/leadgen` |
   | Verify token | The value you set for `META_VERIFY_TOKEN` |

4. Click **Verify and Save**.
   - Meta will send a `GET` request to the callback URL with
     `hub.mode=subscribe` and `hub.challenge`.
   - The CRM will respond with the challenge value to confirm the URL is live.
   - If verification fails, check that `META_VERIFY_TOKEN` matches and that the
     CRM is reachable from the public internet.

5. After verification, click **Add Subscriptions** for the **Page** object and
   tick the `leadgen` field.

![Step 3 — webhook configuration](./img/meta-step-3.png)

---

## Step 4 — Required permissions

The Meta App must have the following permissions approved (needed when tenants
connect their Facebook Pages via OAuth):

| Permission | Purpose |
|-----------|---------|
| `pages_manage_metadata` | Subscribe a page to webhooks |
| `leads_retrieval` | Fetch full lead data from a submitted Lead Ad form |
| `pages_show_list` | List the user's pages during OAuth connection |
| `business_management` | Required for Business accounts |

To add permissions:
1. App dashboard → **App Review → Permissions and Features**.
2. Search for each permission and click **Request**.
3. Submit for review (Meta requires a screencast for `leads_retrieval`).

---

## Step 5 — Tenant page connection flow

When a tenant connects their Facebook Page in **Settings → Channels → Facebook**
and saves the `pageId` + `pageAccessToken`, the CRM stores them in
`ChannelConfig.config`:

```json
{
  "page_id": "123456789",
  "access_token": "<page-scoped-access-token>",
  "subscribedToLeadgen": false
}
```

The tenant then enables **Lead Ads notifications** using the toggle on the
Channels settings page.  This calls:

```
POST /api/channel-configs/:id/leadgen
```

Which calls:

```
POST /{page-id}/subscribed_apps?subscribed_fields=leadgen&access_token={pageAccessToken}
```

on the Meta Graph API and sets `subscribedToLeadgen: true` in `ChannelConfig.config`.

To disable, the tenant toggles it off — the CRM calls:

```
DELETE /{page-id}/subscribed_apps?access_token={pageAccessToken}
```

---

## Webhook flow (summary)

```
Meta Lead Ad submitted
  → Meta sends POST /api/webhooks/meta/leadgen
  → CRM verifies X-Hub-Signature-256 using META_APP_SECRET
  → CRM looks up ChannelConfig by config.page_id
  → CRM fetches full lead from Meta Graph API using config.access_token
  → CRM runs intake pipeline → Lead created in DB
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Webhook verification fails | Wrong `META_VERIFY_TOKEN` | Match env var to Meta App setting |
| Leads not appearing | `subscribedToLeadgen` is false | Enable toggle in Settings → Channels |
| 401 on lead fetch | Expired page access token | Tenant re-connects the Facebook Page |
| 401 on webhook POST | Wrong `META_APP_SECRET` | Rotate and update env var |
| Page not found in ChannelConfig | `page_id` not stored | Re-save Facebook channel config with Page ID |

---

## Security notes

- `META_APP_SECRET` must never appear in client-side code or logs.
- The CRM uses `timingSafeEqual` for HMAC comparison to prevent timing attacks.
- Page access tokens are stored encrypted at rest in `ChannelConfig.credentials`
  and also in `ChannelConfig.config.access_token` (plaintext) for use by the
  webhook handler.  If at-rest encryption of `config` is required, add
  `access_token` to the encrypted credentials only and update the handler.
- `META_VERIFY_TOKEN` is used only during webhook registration, not per-request
  verification.
