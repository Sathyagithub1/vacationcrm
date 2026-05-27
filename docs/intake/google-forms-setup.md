# Google Forms → Holiday Delight CRM: Setup Guide

This guide walks you through connecting a Google Form to your CRM using the
Apps Script bridge template.  After completing setup, every new form submission
will appear in the CRM in near real-time.

**Time required:** ~10 minutes per form.

---

## Prerequisites

- A Google Form you own (or are an editor of).
- Your CRM tenant token and signing key — both available in
  **CRM → Settings → Channels → Google Forms**.

---

## Step 1 — Open the Apps Script editor

1. Open your Google Form in a browser.
2. Click the three-dot menu (⋮) in the top-right corner of the form editor.
3. Select **Script editor**.

![Step 1 — open script editor](./img/google-forms-step-1.png)

The Apps Script editor opens in a new tab with a default `Code.gs` file.

---

## Step 2 — Paste the template

1. Select all existing code in `Code.gs` and delete it.
2. Open the template file:
   [`google-forms-template.gs`](./google-forms-template.gs)
3. Copy the entire file content and paste it into the empty `Code.gs` editor.
4. Press **Ctrl + S** (Windows / Linux) or **Cmd + S** (macOS) to save.

![Step 2 — paste template code](./img/google-forms-step-2.png)

---

## Step 3 — Configure Script Properties

Script Properties store sensitive values outside of your code (they are
**private to your script** and never visible to form respondents).

1. Click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll down to the **Script Properties** section.
3. Click **Add script property** and add the following three keys:

   | Property name  | Value                                                            |
   |----------------|------------------------------------------------------------------|
   | `TENANT_TOKEN` | Your CRM intake token (from **Settings → Channels → Google Forms → Token**) |
   | `SIGNING_KEY`  | Your CRM signing key (from **Settings → Channels → Google Forms → Signing Key**) |
   | `CRM_ENDPOINT` | `https://YOUR_DOMAIN/api/webhooks/google-forms`                 |

   Replace `YOUR_DOMAIN` with your CRM's hostname (e.g. `crm.example.com`).

4. Click **Save script properties**.

![Step 3 — add script properties](./img/google-forms-step-3.png)

> **Security note:** Never share your Script Properties publicly.  If your
> signing key is exposed, rotate it in both Script Properties and CRM Settings
> immediately.

---

## Step 4 — Install the trigger

The trigger tells Apps Script to run `onFormSubmit` automatically each time
someone submits your form.

1. In the Apps Script editor, select the function `installTrigger` from the
   function drop-down (next to the ▶ Run button).
2. Click **▶ Run**.
3. Google will ask you to **authorise** the script — click **Review
   permissions**, choose your Google account, and click **Allow**.
   (The script needs `UrlFetchApp` to POST to the CRM and `FormApp` to read
   responses.)
4. After the run completes, check the **Execution log** at the bottom of the
   screen — you should see:
   ```
   onFormSubmit trigger installed for form: Your Form Title
   ```

![Step 4 — install trigger](./img/google-forms-step-4.png)

> **Already have a trigger?** Running `installTrigger` is safe to repeat — it
> removes any existing `onFormSubmit` trigger before creating a new one, so you
> won't get duplicate submissions.

---

## Step 5 — Test the connection

Before going live, run the built-in connectivity test:

1. In the Apps Script editor, select the function `testConnection` from the
   function drop-down.
2. Click **▶ Run**.
3. Check the **Execution log** — a successful test shows:
   ```
   [CRM Bridge] testConnection → 200: {"ok":true,...}
   ```
   A non-200 response means there is a configuration problem — double-check
   your Script Properties (step 3) and ensure the CRM endpoint URL is correct.

![Step 5 — test connection](./img/google-forms-step-5.png)

---

## Step 6 — Submit a real test response

1. Preview your form (click the eye icon in the form editor).
2. Fill in the form and click **Submit**.
3. Open your CRM and navigate to **Leads** — the test lead should appear within
   a few seconds.

![Step 6 — verify lead in CRM](./img/google-forms-step-6.png)

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `testConnection → 401` | Wrong `TENANT_TOKEN` | Re-copy from CRM Settings |
| `testConnection → 403` | Wrong `SIGNING_KEY` | Rotate and re-copy from CRM Settings |
| `testConnection → 404` | Wrong `CRM_ENDPOINT` | Check the URL — no trailing slash |
| No leads appearing | Trigger not installed | Re-run `installTrigger` |
| Script needs re-authorisation | Permissions revoked | Re-run `installTrigger` and approve again |

---

## Rotating credentials

If you need to change the signing key (e.g. after a suspected exposure):

1. Generate a new signing key in **CRM → Settings → Channels → Google Forms → Rotate Key**.
2. Copy the new key.
3. Update the `SIGNING_KEY` Script Property in Apps Script.
4. Click **Save script properties**.

Both sides update atomically — no form submissions will be lost as long as you
complete both steps within the same editing session.

---

## Connecting multiple forms

Repeat this guide for each Google Form.  Each form uses the same
`TENANT_TOKEN` but must be a **separate Apps Script project** (each form has
its own script editor).  You can reuse the same `SIGNING_KEY` across forms for
the same tenant.
