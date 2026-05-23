import { prisma, tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Public getter: fetch a WidgetConfig by tenant slug + department slug.
 * Also returns basic tenant branding fields.
 * No auth required — used by the embeddable widget.
 */
export async function getWidgetConfig(tenantSlug: string, departmentSlug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: {
      id: true,
      name: true,
      productName: true,
      logoUrl: true,
      themeConfig: true,
    },
  });

  if (!tenant) return null;

  const department = await prisma.department.findFirst({
    where: { tenantId: tenant.id, slug: departmentSlug, isActive: true },
    select: { id: true, name: true, color: true },
  });

  if (!department) return null;

  const config = await (prisma as any).widgetConfig.findFirst({
    where: { tenantId: tenant.id, departmentId: department.id, isActive: true },
    select: {
      id: true,
      welcomeMessage: true,
      placeholderText: true,
      position: true,
      buttonIcon: true,
      themeOverride: true,
      offlineMessage: true,
      quickActions: true,
      businessHours: true,
      autoOpenDelayMs: true,
    },
  }) as Record<string, unknown> | null;

  if (!config) return null;

  return {
    ...config,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      productName: tenant.productName,
      logoUrl: tenant.logoUrl,
      themeConfig: tenant.themeConfig,
    },
    department: {
      id: department.id,
      name: department.name,
      color: department.color,
    },
  };
}

// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * Admin: list all WidgetConfigs for the tenant.
 */
export async function listWidgetConfigs(db: TenantDb) {
  return (db as any).widgetConfig.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { id: true, name: true, slug: true, color: true } },
    },
  });
}

interface CreateWidgetConfigData {
  departmentId: string;
  welcomeMessage?: string;
  placeholderText?: string;
  position?: "BOTTOM_RIGHT" | "BOTTOM_LEFT";
  buttonIcon?: "CHAT" | "HELP" | "CUSTOM";
  themeOverride?: Record<string, unknown>;
  offlineMessage?: string;
  quickActions?: Array<{ label: string; message: string }>;
  businessHours?: Record<string, unknown>;
  autoOpenDelayMs?: number;
  maxConcurrentVisitors?: number;
}

/**
 * Admin: create a WidgetConfig for a department.
 * Each department can have at most one config (enforced by @@unique).
 */
export async function createWidgetConfig(db: TenantDb, data: CreateWidgetConfigData) {
  return (db as any).widgetConfig.create({
    data: {
      departmentId: data.departmentId,
      welcomeMessage: data.welcomeMessage ?? "Hello! How can we help you today?",
      placeholderText: data.placeholderText ?? "Type a message...",
      position: data.position ?? "BOTTOM_RIGHT",
      buttonIcon: data.buttonIcon ?? "CHAT",
      themeOverride: data.themeOverride ?? undefined,
      offlineMessage:
        data.offlineMessage ?? "We are currently offline. Leave a message and we'll get back to you.",
      quickActions: data.quickActions ?? undefined,
      businessHours: data.businessHours ?? undefined,
      autoOpenDelayMs: data.autoOpenDelayMs ?? 0,
      maxConcurrentVisitors: data.maxConcurrentVisitors ?? 100,
      isActive: true,
    },
    include: {
      department: { select: { id: true, name: true, slug: true, color: true } },
    },
  });
}

interface UpdateWidgetConfigData {
  welcomeMessage?: string;
  placeholderText?: string;
  position?: "BOTTOM_RIGHT" | "BOTTOM_LEFT";
  buttonIcon?: "CHAT" | "HELP" | "CUSTOM";
  themeOverride?: Record<string, unknown> | null;
  offlineMessage?: string;
  quickActions?: Array<{ label: string; message: string }> | null;
  businessHours?: Record<string, unknown> | null;
  autoOpenDelayMs?: number;
  maxConcurrentVisitors?: number;
  isActive?: boolean;
}

/**
 * Admin: update an existing WidgetConfig by id.
 */
export async function updateWidgetConfig(db: TenantDb, id: string, data: UpdateWidgetConfigData) {
  const existing = await (db as any).widgetConfig.findFirst({ where: { id } }) as Record<string, unknown> | null;
  if (!existing) throw new Error("Widget config not found");

  const updatePayload: Record<string, unknown> = {};
  if (data.welcomeMessage !== undefined) updatePayload.welcomeMessage = data.welcomeMessage;
  if (data.placeholderText !== undefined) updatePayload.placeholderText = data.placeholderText;
  if (data.position !== undefined) updatePayload.position = data.position;
  if (data.buttonIcon !== undefined) updatePayload.buttonIcon = data.buttonIcon;
  if (data.themeOverride !== undefined) updatePayload.themeOverride = data.themeOverride;
  if (data.offlineMessage !== undefined) updatePayload.offlineMessage = data.offlineMessage;
  if (data.quickActions !== undefined) updatePayload.quickActions = data.quickActions;
  if (data.businessHours !== undefined) updatePayload.businessHours = data.businessHours;
  if (data.autoOpenDelayMs !== undefined) updatePayload.autoOpenDelayMs = data.autoOpenDelayMs;
  if (data.maxConcurrentVisitors !== undefined)
    updatePayload.maxConcurrentVisitors = data.maxConcurrentVisitors;
  if (data.isActive !== undefined) updatePayload.isActive = data.isActive;

  return (db as any).widgetConfig.update({
    where: { id },
    data: updatePayload,
    include: {
      department: { select: { id: true, name: true, slug: true, color: true } },
    },
  });
}
