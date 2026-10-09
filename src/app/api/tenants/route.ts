import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAuth, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { hasPermission } from "@/modules/auth/rbac";
import { buildThemeConfig } from "@/modules/white-label/theme.service";
import { logAudit } from "@/modules/audit/audit.service";
import { encryptCredential } from "@/lib/crypto/credential-encryption";
import { provisionTenant, slugify } from "@/lib/tenant-provisioning";
import type { Permission } from "@/types";

const MASK = "••••••••";
const MASK_PATTERN = /^[•]+$/;

/** True iff the caller sent a real new value (non-empty, not the masked sentinel). */
function isDirtySecret(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !MASK_PATTERN.test(v);
}

const MASKED_EMAIL_CONFIG_KEYS = ["smtpPass", "smsApiKey", "whatsappApiKey"] as const;
const MASKED_TENANT_KEYS = [
  "razorpayKeySecret",
  "razorpayWebhookSecret",
  "telephonyApiKey",
  "telephonyApiSecret",
  "sttApiKey",
  "ttsApiKey",
] as const;

/**
 * Replace every stored secret on a tenant record with the sentinel, in place,
 * so the wire never carries the (encrypted) value. Used by GET and PUT.
 */
function maskTenantSecrets<T extends object>(tenant: T): T {
  const t = tenant as Record<string, unknown>;
  const emailConfig = t.emailTemplateConfig as Record<string, unknown> | null | undefined;
  if (emailConfig) {
    for (const key of MASKED_EMAIL_CONFIG_KEYS) {
      if (emailConfig[key]) emailConfig[key] = MASK;
    }
  }
  for (const key of MASKED_TENANT_KEYS) {
    if (t[key]) t[key] = MASK;
  }
  return tenant;
}

/**
 * GET /api/tenants — Get current tenant info (for use-tenant hook and settings pages).
 *
 * Secret fields are masked: clients receive "••••••••" instead of the stored
 * (encrypted) value, so the wire never carries reversible material.
 */
export async function GET() {
  try {
    const { user } = await requireAuth();

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        domain: true,
        logoUrl: true,
        faviconUrl: true,
        productName: true,
        themeConfig: true,
        loginBgUrl: true,
        emailTemplateConfig: true,
        notificationSettings: true,
        timezone: true,
        currency: true,
        address: true,
        subscriptionStatus: true,
        createdAt: true,
        // Phase 6i — webhook URL hints in the settings UI need the real token
        intakeToken: true,
        // Phase 6c — Razorpay
        razorpayKeyId: true,
        razorpayKeySecret: true,
        razorpayWebhookSecret: true,
        // Phase 6d — Telephony + STT + TTS
        telephonyProvider: true,
        telephonyApiKey: true,
        telephonyApiSecret: true,
        telephonyPhoneNumber: true,
        sttProvider: true,
        sttApiKey: true,
        ttsProvider: true,
        ttsApiKey: true,
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Mask emailTemplateConfig + Phase 6c-6d secrets — never return the (encrypted) value
    return NextResponse.json({ tenant: maskTenantSecrets(tenant) });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return unauthorized();
    }
    return NextResponse.json({ error: "Failed to fetch tenant" }, { status: 500 });
  }
}

/**
 * PUT /api/tenants — Update tenant settings (general, branding, integrations).
 *
 * Secret fields (passwords, API keys) are encrypted at rest via AES-256-GCM
 * (see src/lib/crypto/credential-encryption.ts). The wire format sentinel "••••••••"
 * is treated as "no change" — clients must send the real new value to update.
 */
export async function PUT(request: Request) {
  try {
    // Phase 6i — permission gating is per-section. Auth happens once; then
    // each section the request touches is checked against its own permission.
    // Before this, all fields rode on `settings:general`, which meant a role
    // with general access could rotate Razorpay/telephony secrets it had no
    // business changing.
    const { user } = await requireAuth();

    const body = await request.json();
    const {
      // General settings
      name,
      address,
      timezone,
      currency,
      // Branding
      productName,
      primaryColor,
      secondaryColor,
      presetName,
      // Integrations (stored in emailTemplateConfig JSON blob)
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      smtpFrom,
      smsApiKey,
      smsApiUrl,
      whatsappApiKey,
      whatsappApiUrl,
      // Phase 6c — Razorpay
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      // Phase 6d — Telephony + STT + TTS
      telephonyProvider,
      telephonyApiKey,
      telephonyApiSecret,
      telephonyPhoneNumber,
      sttProvider,
      sttApiKey,
      ttsProvider,
      ttsApiKey,
    } = body;

    const generalTouched =
      name !== undefined || address !== undefined ||
      timezone !== undefined || currency !== undefined;
    const brandingTouched =
      productName !== undefined ||
      (primaryColor !== undefined && secondaryColor !== undefined);
    const integrationsTouched =
      smtpHost !== undefined || smtpPort !== undefined || smtpUser !== undefined ||
      smtpPass !== undefined || smtpFrom !== undefined || smsApiKey !== undefined ||
      smsApiUrl !== undefined || whatsappApiKey !== undefined || whatsappApiUrl !== undefined ||
      razorpayKeyId !== undefined || razorpayKeySecret !== undefined ||
      razorpayWebhookSecret !== undefined ||
      telephonyProvider !== undefined || telephonyApiKey !== undefined ||
      telephonyApiSecret !== undefined || telephonyPhoneNumber !== undefined ||
      sttProvider !== undefined || sttApiKey !== undefined ||
      ttsProvider !== undefined || ttsApiKey !== undefined;

    const requiredPerms: Permission[] = [];
    if (generalTouched) requiredPerms.push("settings:general");
    if (brandingTouched) requiredPerms.push("settings:branding");
    if (integrationsTouched) requiredPerms.push("settings:integrations");

    for (const perm of requiredPerms) {
      if (!hasPermission(user.role, perm)) {
        return forbidden();
      }
    }

    const updateData: Record<string, unknown> = {};

    // General fields
    if (name !== undefined) updateData.name = name.trim();
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (currency !== undefined) updateData.currency = currency;

    // Branding fields
    if (productName !== undefined) updateData.productName = productName.trim();
    if (primaryColor && secondaryColor) {
      updateData.themeConfig = buildThemeConfig(primaryColor, secondaryColor, presetName);
    }

    // Integrations — store as emailTemplateConfig JSON
    if (smtpHost !== undefined || smtpPort !== undefined || smtpUser !== undefined ||
        smtpPass !== undefined || smtpFrom !== undefined || smsApiKey !== undefined ||
        smsApiUrl !== undefined || whatsappApiKey !== undefined || whatsappApiUrl !== undefined) {
      const existing = await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { emailTemplateConfig: true },
      });

      const existingConfig = (existing?.emailTemplateConfig as Record<string, unknown>) || {};

      const integrations: Record<string, unknown> = { ...existingConfig };

      if (smtpHost !== undefined) integrations.smtpHost = smtpHost;
      if (smtpPort !== undefined) integrations.smtpPort = smtpPort;
      if (smtpUser !== undefined) integrations.smtpUser = smtpUser;
      if (smtpFrom !== undefined) integrations.smtpFrom = smtpFrom;
      if (smsApiUrl !== undefined) integrations.smsApiUrl = smsApiUrl;
      if (whatsappApiUrl !== undefined) integrations.whatsappApiUrl = whatsappApiUrl;

      if (isDirtySecret(smtpPass)) integrations.smtpPass = smtpPass;
      if (isDirtySecret(smsApiKey)) integrations.smsApiKey = smsApiKey;
      if (isDirtySecret(whatsappApiKey)) integrations.whatsappApiKey = whatsappApiKey;

      updateData.emailTemplateConfig = integrations;
    }

    // Phase 6c — Razorpay
    // Non-secret: razorpayKeyId stored plain (it's a public identifier)
    if (razorpayKeyId !== undefined) {
      updateData.razorpayKeyId = razorpayKeyId?.trim() || null;
    }
    // Secrets: encrypt-on-write
    if (isDirtySecret(razorpayKeySecret)) {
      updateData.razorpayKeySecret = encryptCredential(razorpayKeySecret);
    }
    if (isDirtySecret(razorpayWebhookSecret)) {
      updateData.razorpayWebhookSecret = encryptCredential(razorpayWebhookSecret);
    }

    // Phase 6d — Telephony
    if (telephonyProvider !== undefined) {
      const val = typeof telephonyProvider === "string" ? telephonyProvider.trim().toUpperCase() : "";
      updateData.telephonyProvider = val || null;
    }
    if (telephonyPhoneNumber !== undefined) {
      updateData.telephonyPhoneNumber = telephonyPhoneNumber?.trim() || null;
    }
    if (isDirtySecret(telephonyApiKey)) {
      updateData.telephonyApiKey = encryptCredential(telephonyApiKey);
    }
    if (isDirtySecret(telephonyApiSecret)) {
      updateData.telephonyApiSecret = encryptCredential(telephonyApiSecret);
    }

    // Phase 6d — STT
    if (sttProvider !== undefined) {
      const val = typeof sttProvider === "string" ? sttProvider.trim().toUpperCase() : "";
      updateData.sttProvider = val || null;
    }
    if (isDirtySecret(sttApiKey)) {
      updateData.sttApiKey = encryptCredential(sttApiKey);
    }

    // Phase 6d — TTS
    if (ttsProvider !== undefined) {
      const val = typeof ttsProvider === "string" ? ttsProvider.trim().toUpperCase() : "";
      updateData.ttsProvider = val || null;
    }
    if (isDirtySecret(ttsApiKey)) {
      updateData.ttsApiKey = encryptCredential(ttsApiKey);
    }

    if (Object.keys(updateData).length === 0) {
      // A secret sent as the masked sentinel means "keep the existing
      // secret" — the same value GET hands out. A request carrying only such
      // sentinels is a valid no-op: return the unchanged tenant (masked)
      // without writing or auditing anything. A body with nothing to apply
      // (empty, or secrets sent as "") is still a client error.
      const sentKeepSentinel = [
        smtpPass, smsApiKey, whatsappApiKey,
        razorpayKeySecret, razorpayWebhookSecret,
        telephonyApiKey, telephonyApiSecret, sttApiKey, ttsApiKey,
      ].some((v) => typeof v === "string" && MASK_PATTERN.test(v));
      if (!sentKeepSentinel) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }
      const unchanged = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!unchanged) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
      }
      return NextResponse.json({ tenant: maskTenantSecrets(unchanged) });
    }

    const tenant = await prisma.tenant.update({
      where: { id: user.tenantId },
      data: updateData,
    });

    // Audit log — record which fields changed, but never log secret values
    const auditFields = Object.keys(updateData).reduce<Record<string, unknown>>((acc, k) => {
      const secretKeys = [
        "razorpayKeySecret", "razorpayWebhookSecret",
        "telephonyApiKey", "telephonyApiSecret",
        "sttApiKey", "ttsApiKey",
        "emailTemplateConfig",
      ];
      acc[k] = secretKeys.includes(k) ? "<redacted>" : updateData[k];
      return acc;
    }, {});

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "tenant.update",
      entityType: "Tenant",
      entityId: tenant.id,
      newValue: auditFields,
    });

    // Phase 6h — mask secrets in PUT response so the wire never carries
    // the (encrypted) ciphertext to the client. GET applies the same masking;
    // before this fix PUT silently leaked the v1:... blob in its 200 body.
    return NextResponse.json({ tenant: maskTenantSecrets(tenant) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("[Tenants] Update error:", error);
    return NextResponse.json({ error: "Failed to update tenant" }, { status: 500 });
  }
}

/**
 * POST /api/tenants — Public self-service tenant signup (multi-tenant SaaS).
 *
 * DEFAULT-OFF GUARANTEE:
 *   Returns 403 unless SIGNUP_ENABLED === "true". In the default deployment
 *   (flag unset) this endpoint is a hard 403 and no tenant can be created via
 *   the web, so the live single-tenant app is untouched.
 *
 * When enabled, creates a new tenant + its first COMPANY_ADMIN user + default
 * departments / pipeline stages / follow-up rules TRANSACTIONALLY. Password is
 * bcrypt-hashed (cost 12) like the rest of the app; email is lowercased so it
 * matches auth-options' login lookup. Duplicate slug/email → 409. This handler
 * NEVER touches any other tenant's data.
 */
export async function POST(request: Request) {
  // Flag gate — closed by default.
  if (process.env.SIGNUP_ENABLED !== "true") {
    return NextResponse.json({ error: "Signups are currently closed" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "";
  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // ── Validation ──────────────────────────────────────────────────────────
  if (!companyName || companyName.length < 2) {
    return NextResponse.json({ error: "companyName is required (min 2 chars)" }, { status: 400 });
  }
  if (!adminName || adminName.length < 2) {
    return NextResponse.json({ error: "adminName is required (min 2 chars)" }, { status: 400 });
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
  if (!emailOk) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const email = rawEmail.toLowerCase();
  const slug = slugify(companyName);
  if (!slug) {
    return NextResponse.json({ error: "companyName must contain letters or numbers" }, { status: 400 });
  }

  try {
    // Cheap pre-checks for a friendly 409 (the transaction's unique constraints
    // are the real guard against races — we still catch P2002 below).
    const [slugTaken, emailTaken] = await Promise.all([
      prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
      prisma.user.findFirst({ where: { email }, select: { id: true } }),
    ]);
    if (slugTaken) {
      return NextResponse.json({ error: "A workspace with this name already exists" }, { status: 409 });
    }
    if (emailTaken) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Atomic: tenant + admin + departments + stages + rules, or nothing.
    // The extended client's interactive-tx type is structurally a
    // Prisma.TransactionClient for the delegates we use; cast to bridge the
    // tour-sold `$extends` wrapper's narrower callback type.
    const result = await prisma.$transaction(async (tx) =>
      provisionTenant(tx as unknown as Parameters<typeof provisionTenant>[0], {
        companyName,
        slug,
        adminName,
        adminEmail: email,
        adminPasswordHash: passwordHash,
      }),
    );

    // Best-effort audit (never blocks signup success).
    await logAudit({
      tenantId: result.tenantId,
      userId: result.adminUserId,
      action: "tenant.signup",
      entityType: "Tenant",
      entityId: result.tenantId,
      newValue: { companyName, slug: result.slug, adminEmail: email },
    }).catch(() => {});

    return NextResponse.json(
      { tenant: { id: result.tenantId, slug: result.slug }, ok: true },
      { status: 201 },
    );
  } catch (error) {
    // Prisma unique-constraint violation (race on slug/email) → 409.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A workspace or account with these details already exists" },
        { status: 409 },
      );
    }
    console.error("[Tenants] Signup error:", error);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
