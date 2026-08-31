/**
 * src/lib/tenant-provisioning.ts — Shared new-tenant provisioning logic.
 *
 * Mirrors scripts/seed.ts (departments + global pipeline stages + follow-up
 * rules + canned responses) so public signup produces a tenant identical in
 * shape to the seeded live tenant. The seed script remains the source of truth
 * for the DEFAULT tenant; this module reuses the SAME data definitions for
 * newly-signed-up tenants.
 *
 * The provision function is designed to run INSIDE a prisma.$transaction so a
 * tenant is either created completely (tenant + admin + departments + stages)
 * or not at all — never a half-provisioned tenant.
 *
 * MULTI-TENANT SAFETY: every write here is scoped to the freshly-created
 * tenant's id. It NEVER reads, updates, or deletes any other tenant's data.
 */

import type { Prisma } from "@prisma/client";

/**
 * Transaction client type accepted by provisionTenant. Only model delegates
 * (tenant/user/department/...) are used, all present on the interactive
 * transaction client passed by prisma.$transaction(async (tx) => ...).
 */
type Tx = Prisma.TransactionClient;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ── Default data (kept in sync with scripts/seed.ts) ─────────────────────────

export const DEFAULT_DEPARTMENTS = [
  { name: "Sales", icon: "plane", color: "#9C27B0" },
  { name: "Support", icon: "help", color: "#2196F3" },
] as const;

export const DEFAULT_PIPELINE_STAGES = [
  { name: "New", position: 0, color: "#6B7280", isDefault: true, isSystem: true },
  { name: "Contacted", position: 1, color: "#3B82F6", isDefault: false, isSystem: true },
  { name: "Follow-up", position: 2, color: "#F59E0B", isDefault: false, isSystem: true },
  { name: "Quotation Sent", position: 3, color: "#8B5CF6", isDefault: false, isSystem: true },
  { name: "Negotiation", position: 4, color: "#EC4899", isDefault: false, isSystem: true },
  { name: "Converted", position: 5, color: "#10B981", isDefault: false, isSystem: true },
  { name: "Lost", position: 6, color: "#EF4444", isDefault: false, isSystem: true },
  { name: "Dormant", position: 7, color: "#9CA3AF", isDefault: false, isSystem: true },
] as const;

export const DEFAULT_FOLLOW_UP_RULES = [
  {
    triggerType: "STAGE_CHANGE" as const,
    triggerValue: "quotation-sent",
    followUpType: "REMINDER" as const,
    delayHours: 24,
    messageTemplate: "Follow up on quotation sent to the customer.",
  },
  {
    triggerType: "STAGE_CHANGE" as const,
    triggerValue: "negotiation",
    followUpType: "PAYMENT" as const,
    delayHours: 48,
    messageTemplate: "Reminder: payment is pending for this lead.",
  },
];

export interface ProvisionTenantInput {
  companyName: string;
  slug: string;
  adminName: string;
  adminEmail: string; // MUST already be lowercased by caller
  adminPasswordHash: string; // MUST already be bcrypt-hashed by caller
}

export interface ProvisionTenantResult {
  tenantId: string;
  adminUserId: string;
  slug: string;
}

/**
 * Create a brand-new tenant plus its first COMPANY_ADMIN user and default
 * departments / pipeline stages / follow-up rules / canned responses.
 *
 * Run inside prisma.$transaction([...]) or prisma.$transaction(async (tx) => ...)
 * — pass the transaction client as `tx` so the whole thing is atomic.
 *
 * Uniqueness collisions (duplicate slug / email) surface as Prisma P2002 errors
 * for the caller to translate into a 409.
 */
export async function provisionTenant(
  tx: Tx,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  // 1. Tenant
  const tenant = await tx.tenant.create({
    data: {
      name: input.companyName,
      slug: input.slug,
      productName: "Holiday Delight CRM",
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });

  // 2. First COMPANY_ADMIN user (email stored lowercase, per auth-options note)
  const adminUser = await tx.user.create({
    data: {
      tenantId: tenant.id,
      email: input.adminEmail,
      passwordHash: input.adminPasswordHash,
      name: input.adminName,
      role: "COMPANY_ADMIN",
      isActive: true,
    },
  });

  // 3. Departments
  const deptIdBySlug: Record<string, string> = {};
  for (const dept of DEFAULT_DEPARTMENTS) {
    const deptSlug = slugify(dept.name);
    const created = await tx.department.create({
      data: {
        tenantId: tenant.id,
        name: dept.name,
        slug: deptSlug,
        icon: dept.icon,
        color: dept.color,
        isActive: true,
      },
    });
    deptIdBySlug[deptSlug] = created.id;
  }

  // 4. Global pipeline stages (no department)
  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await tx.pipelineStage.create({
      data: {
        tenantId: tenant.id,
        name: stage.name,
        slug: slugify(stage.name),
        color: stage.color,
        position: stage.position,
        isDefault: stage.isDefault,
        isSystem: stage.isSystem,
      },
    });
  }

  // 5. Follow-up rules
  for (const rule of DEFAULT_FOLLOW_UP_RULES) {
    await tx.followUpRule.create({
      data: {
        tenantId: tenant.id,
        triggerType: rule.triggerType,
        triggerValue: rule.triggerValue,
        followUpType: rule.followUpType,
        delayHours: rule.delayHours,
        messageTemplate: rule.messageTemplate,
        isActive: true,
      },
    });
  }

  // 6. A starter canned response per default department
  const CANNED: Record<string, { title: string; content: string; shortcut: string }> = {
    sales: {
      title: "Greeting",
      content:
        "Hello! Thanks for reaching out. How can we help you plan your next trip today?",
      shortcut: "/greet",
    },
    support: {
      title: "Greeting",
      content: "Hi! You've reached Support. How can we help you today?",
      shortcut: "/greet",
    },
  };
  for (const [deptSlug, resp] of Object.entries(CANNED)) {
    const deptId = deptIdBySlug[deptSlug];
    if (!deptId) continue;
    await tx.cannedResponse.create({
      data: {
        tenantId: tenant.id,
        departmentId: deptId,
        title: resp.title,
        content: resp.content,
        shortcut: resp.shortcut,
        createdBy: adminUser.id,
        isActive: true,
      },
    });
  }

  return { tenantId: tenant.id, adminUserId: adminUser.id, slug: tenant.slug };
}
