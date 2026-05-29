import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { buildThemeConfig } from "@/modules/white-label/theme.service";
import { logAudit } from "@/modules/audit/audit.service";
import { encryptCredential } from "@/lib/crypto/credential-encryption";

const MASK = "••••••••";
const MASK_PATTERN = /^[•]+$/;

/** True iff the caller sent a real new value (non-empty, not the masked sentinel). */
function isDirtySecret(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !MASK_PATTERN.test(v);
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

    // Mask sensitive credentials in emailTemplateConfig JSON
    const emailConfig = tenant.emailTemplateConfig as Record<string, unknown> | null;
    if (emailConfig) {
      if (emailConfig.smtpPass) emailConfig.smtpPass = MASK;
      if (emailConfig.smsApiKey) emailConfig.smsApiKey = MASK;
      if (emailConfig.whatsappApiKey) emailConfig.whatsappApiKey = MASK;
      (tenant as Record<string, unknown>).emailTemplateConfig = emailConfig;
    }

    // Mask Phase 6c-6d secret fields — never return the (encrypted) value
    const t = tenant as Record<string, unknown>;
    if (t.razorpayKeySecret) t.razorpayKeySecret = MASK;
    if (t.razorpayWebhookSecret) t.razorpayWebhookSecret = MASK;
    if (t.telephonyApiKey) t.telephonyApiKey = MASK;
    if (t.telephonyApiSecret) t.telephonyApiSecret = MASK;
    if (t.sttApiKey) t.sttApiKey = MASK;
    if (t.ttsApiKey) t.ttsApiKey = MASK;

    return NextResponse.json({ tenant });
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
    const { user } = await requirePermission("settings:general");

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
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
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

    return NextResponse.json({ tenant });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Unauthorized") return unauthorized();
      if (error.message === "Forbidden") return forbidden();
    }
    console.error("[Tenants] Update error:", error);
    return NextResponse.json({ error: "Failed to update tenant" }, { status: 500 });
  }
}
