# Telephony Provider Setup

This document explains how to configure each supported telephony provider for a
Holiday Delight CRM tenant. All credentials are stored in the `Tenant` table as
AES-256-GCM encrypted values (see `src/lib/crypto/credential-encryption.ts`).

---

## Supported Providers

| Provider | `telephonyProvider` value | Region focus |
|----------|--------------------------|-------------|
| Exotel   | `exotel`                 | India       |
| Plivo    | `plivo`                  | Global      |
| Twilio   | `twilio`                 | Global      |
| FreJun   | `frejun`                 | India       |

---

## Exotel

1. Sign up at [exotel.com](https://exotel.com) and obtain your Account SID,
   API Key, and API Token from the dashboard.
2. Create a webhook URL in the form:
   `https://YOUR_CRM_DOMAIN/api/webhooks/voice/{tenantToken}`
3. Configure the tenant:
   - `telephonyProvider`: `"exotel"`
   - `telephonyApiKey`: Encrypted JSON string
     ```json
     { "accountSid": "ACxxxx", "apiKey": "exo_key_xxx", "apiToken": "exo_token_xxx" }
     ```
   - `telephonyApiSecret`: Encrypted webhook secret used to verify
     `X-Exotel-Signature` HMAC-SHA256 headers.

---

## Plivo

1. Sign up at [plivo.com](https://plivo.com) and obtain your Auth ID and
   Auth Token from the console.
2. Set the Answer URL for your Plivo application to:
   `https://YOUR_CRM_DOMAIN/api/webhooks/voice/{tenantToken}`
3. Configure the tenant:
   - `telephonyProvider`: `"plivo"`
   - `telephonyApiKey`: Auth ID (plain string — public identifier)
   - `telephonyApiSecret`: Encrypted Auth Token

---

## Twilio

1. Sign up at [twilio.com](https://twilio.com) and obtain your Account SID
   and Auth Token from the console.
2. Set the webhook URL for your Twilio phone number to:
   `https://YOUR_CRM_DOMAIN/api/webhooks/voice/{tenantToken}`
3. Configure the tenant:
   - `telephonyProvider`: `"twilio"`
   - `telephonyApiKey`: Account SID (plain string — public identifier)
   - `telephonyApiSecret`: Encrypted Auth Token

---

## FreJun

### Overview

FreJun is an India-focused cloud telephony provider. Unlike Exotel (Basic auth +
form-urlencoded), FreJun uses Bearer token authentication with JSON bodies.

API docs: [docs.frejun.com](https://docs.frejun.com)

### Onboarding steps

1. **Sign up at [frejun.com](https://frejun.com)** and log in to the FreJun
   dashboard.

2. **Obtain your API token** from the FreJun dashboard under
   Settings → API Keys. Copy the bearer token (starts with `frj_live_`).

3. **Set up your webhook / callback URL** in the FreJun dashboard under
   Settings → Integrations → Webhooks. Set it to:
   ```
   https://YOUR_CRM_DOMAIN/api/webhooks/voice/{tenantToken}
   ```
   Note the webhook secret that FreJun generates — you will need it below.

4. **Configure the tenant** in the Holiday Delight CRM database:

   - `telephonyProvider`: `"frejun"`

   - `telephonyApiKey`: Encrypted JSON string containing all three FreJun
     credentials:
     ```json
     {
       "apiToken": "frj_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
       "callerNumber": "+919876543210",
       "webhookSecret": "wh_secret_your_frejun_webhook_secret"
     }
     ```
     - `apiToken` — Bearer token from the FreJun dashboard (required)
     - `callerNumber` — Default outbound caller number in E.164 format (optional;
       FreJun uses the account default if omitted)
     - `webhookSecret` — Webhook secret used to verify `X-Frejun-Signature`
       HMAC-SHA256 headers (required)

   - `telephonyApiSecret`: Set to a non-empty placeholder (e.g. `"-"`)  
     FreJun does not use a separate API secret; all credentials live in the
     `telephonyApiKey` JSON above. The field must be non-empty to pass the
     credential-completeness guard in `getTelephonyProvider`.

   **Encrypt the JSON before storing** using `encryptCredential()`:
   ```ts
   import { encryptCredential } from "@/lib/crypto/credential-encryption";

   const encrypted = encryptCredential(JSON.stringify({
     apiToken: "frj_live_...",
     callerNumber: "+91xxxxxxxxxx",
     webhookSecret: "wh_secret_...",
   }));
   // Store `encrypted` in tenant.telephonyApiKey
   ```

### IVR XML (webhook responses)

FreJun's XML dialect (`FrejunML`) uses:

| Action   | Verb                     |
|----------|--------------------------|
| TTS      | `<Speak>text</Speak>`    |
| Transfer | `<Dial>number</Dial>`    |
| Hangup   | `<Hangup/>`              |

In your webhook handler, use:
```ts
import { renderIvrResponse } from "@/lib/telephony/xml";

return new Response(
  renderIvrResponse("FREJUN", { playText: "Welcome! Connecting you now.", transferTo: "+91..." }),
  { headers: { "Content-Type": "application/xml" } },
);
```

### Signature verification

FreJun sends `X-Frejun-Signature` containing a hex-encoded HMAC-SHA256 of
the raw request body using the tenant's `webhookSecret`. The `FreJunAdapter`
verifies this automatically via `verifyWebhookSignature()`.

### Assumptions

The following FreJun API details were inferred from the brief and standard
industry patterns. Verify against the live FreJun docs and adjust if needed:

- `POST /calls` body: `{ from, to, callback_url }` — response: `{ call_id, status }`
- `DELETE /calls/{call_id}` — returns `200` or `204` on success
- `POST /calls/{call_id}/transfer` body: `{ to }` — returns `200` on success
- `POST /calls/{call_id}/recording/start` — returns `200` on success
- `POST /calls/{call_id}/recording/stop` — returns `{ recording_url }`
- `X-Frejun-Signature` is lowercase hex HMAC-SHA256 (not base64)
