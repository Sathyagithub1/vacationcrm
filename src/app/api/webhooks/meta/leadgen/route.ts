/**
 * src/app/api/webhooks/meta/leadgen/route.ts
 *
 * T33 — Meta Lead Ads webhook.
 *
 * GET  /api/webhooks/meta/leadgen  — Hub verification (Meta subscription setup)
 * POST /api/webhooks/meta/leadgen  — Lead-gen event delivery
 *
 * Per-tenant feature flag: INTAKE_PIPELINE_V2_ENABLED
 *   tenant.featureFlags.INTAKE_PIPELINE_V2_ENABLED === false → skip pipeline (503 per entry)
 *   absent key (default '{}')                               → enabled (opt-out, backwards-compatible)
 *
 * Environment vars (.env.local):
 *   META_VERIFY_TOKEN — token configured in the Meta app's webhook settings
 *   META_APP_SECRET   — app secret used for X-Hub-Signature-256 HMAC verification
 *
 * How Meta stores its page access token in ChannelConfig:
 *   channel:     "FACEBOOK"
 *   credentials: JSON string with shape { appSecret, pageAccessToken, pageId? }
 *                (see FacebookAdapter / FacebookCredentials in adapters/facebook.adapter.ts)
 *   config:      { page_id: "<PAGE_ID>", access_token: "<PAGE_ACCESS_TOKEN>" }
 *                — access_token in config is used here so that the intake
 *                  handler can look up by page_id without decrypting credentials.
 *
 * If config.access_token is absent the handler falls back to the
 * pageAccessToken field in the credentials JSON string.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMetaLead } from "@/lib/meta-graph";
import type { MetaLeadFieldData } from "@/lib/meta-graph";
import { runPipeline } from "@/modules/intake/pipeline";
import { getDefaultStages } from "@/modules/intake/stages";
import type { IntakePayload } from "@/modules/intake/types";

const STAGES = getDefaultStages();

// ── Shape interfaces for Meta leadgen webhook body ────────────────────────────

interface MetaLeadgenChange {
  value: {
    leadgen_id: string;
    page_id: string;
    form_id: string;
    created_time: number;
  };
  field: string;
}

interface MetaLeadgenEntry {
  id: string;
  time: number;
  changes: MetaLeadgenChange[];
}

interface MetaLeadgenBody {
  object: string;
  entry: MetaLeadgenEntry[];
}

// ── ChannelConfig credentials / config shape ──────────────────────────────────

interface FacebookCredentials {
  appSecret?: string;
  pageAccessToken?: string;
  pageId?: string;
}

interface FacebookConfig {
  page_id?: string;
  access_token?: string;
}

// ── GET — Meta hub verification ───────────────────────────────────────────────

/**
 * Responds to Meta's subscription verification challenge.
 * Meta sends: hub.mode=subscribe, hub.verify_token, hub.challenge
 * We must return hub.challenge as plain text with 200 when the verify_token
 * matches META_VERIFY_TOKEN.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // META_VERIFY_TOKEN must be set in .env.local
  const expectedToken = process.env.META_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    challenge &&
    expectedToken &&
    token === expectedToken
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ── POST — Lead-gen event delivery ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Read raw body as text for signature verification ───────────────────
  const rawBody = await req.text();

  // ── 2. Verify X-Hub-Signature-256 HMAC ───────────────────────────────────
  const sigHeader = req.headers.get("x-hub-signature-256");
  const appSecret = process.env.META_APP_SECRET;

  if (!sigHeader || !appSecret) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  const expectedSig =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  let sigValid: boolean;
  try {
    sigValid = timingSafeEqual(
      Buffer.from(sigHeader, "utf8"),
      Buffer.from(expectedSig, "utf8"),
    );
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // ── 3. Parse body JSON ────────────────────────────────────────────────────
  let parsed: MetaLeadgenBody;
  try {
    parsed = JSON.parse(rawBody) as MetaLeadgenBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (parsed.object !== "page" || !Array.isArray(parsed.entry)) {
    // Not a leadgen event — acknowledge silently (Meta sends other event types)
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // ── 4. Process each entry / change ────────────────────────────────────────
  let processedCount = 0;

  for (const entry of parsed.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const { leadgen_id, page_id, form_id } = change.value;

      // ── 4a. Look up ChannelConfig for this page ───────────────────────────
      // Prefer Prisma JSON path filter; fall back to JS filter if not supported.
      let channelConfig = await prisma.channelConfig.findFirst({
        where: {
          channel: "FACEBOOK",
          config: { path: ["page_id"], equals: page_id },
        },
      });

      // JS fallback: if DB returns null, fetch all FACEBOOK configs and filter
      if (!channelConfig) {
        const fbConfigs = await prisma.channelConfig.findMany({
          where: { channel: "FACEBOOK" },
        });
        channelConfig =
          fbConfigs.find((c) => {
            const cfg = c.config as FacebookConfig | null;
            return cfg?.page_id === page_id;
          }) ?? null;
      }

      if (!channelConfig) {
        // No ChannelConfig for this page — skip (unknown page, not our tenant)
        continue;
      }

      // ── 4b. Per-tenant pipeline v2 feature flag ───────────────────────────
      // Convention: featureFlags.INTAKE_PIPELINE_V2_ENABLED === false → skip.
      // Absent key or any other value → enabled (opt-out, backwards-compatible).
      const tenant = await prisma.tenant.findUnique({
        where: { id: channelConfig.tenantId },
        select: { featureFlags: true },
      });
      const flags = (tenant?.featureFlags ?? {}) as Record<string, unknown>;
      if (flags["INTAKE_PIPELINE_V2_ENABLED"] === false) {
        console.warn(
          `[webhook/meta/leadgen] Pipeline v2 disabled for tenant ${channelConfig.tenantId}, skipping lead ${leadgen_id}`,
        );
        continue;
      }

      // ── 4c. Extract page access token ─────────────────────────────────────
      // First look in config.access_token (preferred for intake handler).
      // Fall back to credentials JSON pageAccessToken.
      const cfg = channelConfig.config as FacebookConfig | null;
      let accessToken: string | undefined = cfg?.access_token;

      if (!accessToken) {
        try {
          const creds = JSON.parse(channelConfig.credentials) as FacebookCredentials;
          accessToken = creds.pageAccessToken;
        } catch {
          accessToken = undefined;
        }
      }

      if (!accessToken) {
        console.warn(
          `[webhook/meta/leadgen] No access token found for page ${page_id}, skipping lead ${leadgen_id}`,
        );
        continue;
      }

      // ── 4d. Fetch full lead from Meta Graph API ───────────────────────────
      let metaLead;
      try {
        metaLead = await getMetaLead(leadgen_id, accessToken);
      } catch (err: unknown) {
        console.error(
          `[webhook/meta/leadgen] getMetaLead(${leadgen_id}) failed:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }

      // ── 4e. Map field_data to sender + rawPayload ─────────────────────────
      const fieldData: MetaLeadFieldData[] = metaLead.field_data ?? [];

      // Helpers to pull a single value from field_data by name
      const field = (name: string): string | undefined =>
        fieldData.find((f) => f.name === name)?.values[0];

      const senderEmail = field("email");
      const senderPhone = field("phone_number") ?? field("phone");
      const senderName =
        field("full_name") ?? field("name") ?? field("first_name");

      const rawPayload: Record<string, unknown> = {
        leadgen_id,
        page_id,
        form_id,
        field_data: fieldData,
        ...(senderName !== undefined ? { name: senderName } : {}),
        ...(senderEmail !== undefined ? { email: senderEmail } : {}),
        ...(senderPhone !== undefined ? { phone: senderPhone } : {}),
      };

      // ── 4f. Write IntakeWebhookLog ────────────────────────────────────────
      const log = await prisma.intakeWebhookLog.create({
        data: {
          tenantId: channelConfig.tenantId,
          source: "META_LEAD_AD",
          endpoint: "/api/webhooks/meta/leadgen",
          rawPayload,
          signatureValid: true,
          processed: false,
        },
        select: { id: true },
      });

      // ── 4g. Build and run pipeline ────────────────────────────────────────
      const intakePayload: IntakePayload = {
        tenantId: channelConfig.tenantId,
        source: "META_LEAD_AD",
        rawPayload,
        sender: {
          phone: senderPhone,
          email: senderEmail,
          channelHandle: undefined,
        },
        intakeFormId: undefined,
        webhookLogId: log.id,
      };

      try {
        await runPipeline(intakePayload, STAGES);
        processedCount++;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await prisma.intakeWebhookLog.update({
          where: { id: log.id },
          data: { processed: false, errorMessage },
        });
        console.error(
          `[webhook/meta/leadgen] pipeline error for lead ${leadgen_id}:`,
          errorMessage,
        );
      }
    }
  }

  return NextResponse.json({ ok: true, processed: processedCount });
}
