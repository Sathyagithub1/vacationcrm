import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requirePermission, unauthorized, forbidden } from "@/modules/auth/tenant.middleware";
import { buildThemeConfig } from "@/modules/white-label/theme.service";
import { logAudit } from "@/modules/audit/audit.service";

/**
 * GET /api/tenants — Get current tenant info (for use-tenant hook and settings pages).
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
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Mask sensitive credentials before returning
    const emailConfig = tenant.emailTemplateConfig as Record<string, unknown> | null;
    if (emailConfig) {
      if (emailConfig.smtpPass) emailConfig.smtpPass = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      if (emailConfig.smsApiKey) emailConfig.smsApiKey = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      if (emailConfig.whatsappApiKey) emailConfig.whatsappApiKey = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      (tenant as Record<string, unknown>).emailTemplateConfig = emailConfig;
    }

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
      // Integrations (stored in emailTemplateConfig as a JSON blob)
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      smtpFrom,
      smsApiKey,
      smsApiUrl,
      whatsappApiKey,
      whatsappApiUrl,
    } = body;

    const updateData: Record<string, unknown> = {};

    // General fields
    if (name !== undefined) updateData.name = name.trim();
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (currency !== undefined) updateData.currency = currency;

    // Branding fields
    if (productName !== undefined) updateData.productName = productName.trim();

    // Theme — regenerate palette from colors
    if (primaryColor && secondaryColor) {
      updateData.themeConfig = buildThemeConfig(primaryColor, secondaryColor, presetName);
    }

    // Integrations — store as emailTemplateConfig JSON
    if (smtpHost !== undefined || smsApiKey !== undefined || whatsappApiKey !== undefined) {
      // Fetch existing config to merge
      const existing = await prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { emailTemplateConfig: true },
      });

      const existingConfig = (existing?.emailTemplateConfig as Record<string, unknown>) || {};

      const integrations: Record<string, unknown> = {
        ...existingConfig,
      };

      if (smtpHost !== undefined) integrations.smtpHost = smtpHost;
      if (smtpPort !== undefined) integrations.smtpPort = smtpPort;
      if (smtpUser !== undefined) integrations.smtpUser = smtpUser;
      if (smtpPass !== undefined) integrations.smtpPass = smtpPass;
      if (smtpFrom !== undefined) integrations.smtpFrom = smtpFrom;
      if (smsApiKey !== undefined) integrations.smsApiKey = smsApiKey;
      if (smsApiUrl !== undefined) integrations.smsApiUrl = smsApiUrl;
      if (whatsappApiKey !== undefined) integrations.whatsappApiKey = whatsappApiKey;
      if (whatsappApiUrl !== undefined) integrations.whatsappApiUrl = whatsappApiUrl;

      updateData.emailTemplateConfig = integrations;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const tenant = await prisma.tenant.update({
      where: { id: user.tenantId },
      data: updateData,
    });

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: "tenant.update",
      entityType: "Tenant",
      entityId: tenant.id,
      newValue: updateData,
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
