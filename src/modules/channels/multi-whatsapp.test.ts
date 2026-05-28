/**
 * Tests for multi-whatsapp module (6b.1)
 * Tests: create multiple ChannelConfigs per tenant, primary management,
 * resolve by phone number ID, get outbound by department, cross-tenant isolation.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantPrisma } from "@/lib/prisma";
import {
  resolveTenantByPhoneNumberId,
  getOutboundChannelConfig,
  setPrimaryChannelConfig,
  listChannelConfigs,
} from "./multi-whatsapp";

// ─── Test fixtures ─────────────────────────────────────────────────────────

const T1 = "tenant-mw-1";
const T2 = "tenant-mw-2";

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function seedChannelConfig(opts: {
  tenantId: string;
  externalId: string;
  isPrimary?: boolean;
  label?: string;
  isActive?: boolean;
  departmentId?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.channelConfig as any).create({
    data: {
      tenantId: opts.tenantId,
      channel: "WHATSAPP",
      externalId: opts.externalId,
      credentials: '{"token":"test","verifyToken":"vtok"}',
      isPrimary: opts.isPrimary ?? false,
      label: opts.label ?? null,
      isActive: opts.isActive ?? true,
      assignedDepartmentId: opts.departmentId ?? null,
    },
  });
}

async function clearAll() {
  await prisma.channelConfig.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.department.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("multi-whatsapp", () => {
  beforeEach(async () => {
    await ensureTenant(T1);
    await ensureTenant(T2);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("creates multiple ChannelConfigs per tenant for same channel", async () => {
    await seedChannelConfig({ tenantId: T1, externalId: "101" });
    await seedChannelConfig({ tenantId: T1, externalId: "102" });
    await seedChannelConfig({ tenantId: T1, externalId: "103" });

    const configs = await listChannelConfigs(T1, "WHATSAPP");
    expect(configs).toHaveLength(3);
  });

  it("resolves tenant by phone number ID", async () => {
    await seedChannelConfig({ tenantId: T1, externalId: "PHONEID_999" });

    const result = await resolveTenantByPhoneNumberId("PHONEID_999");
    expect(result).not.toBeNull();
    expect(result!.tenant.id).toBe(T1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result!.channelConfig as any).externalId).toBe("PHONEID_999");
  });

  it("returns null for unknown phone number ID", async () => {
    const result = await resolveTenantByPhoneNumberId("UNKNOWN_PHONE");
    expect(result).toBeNull();
  });

  it("cross-tenant isolation: phone number ID only resolves to its own tenant", async () => {
    await seedChannelConfig({ tenantId: T1, externalId: "SHARED_ID" });
    // T2 does not have this phone number ID

    const result = await resolveTenantByPhoneNumberId("SHARED_ID");
    expect(result!.tenant.id).toBe(T1); // only T1
  });

  it("setPrimaryChannelConfig flips old primary to false", async () => {
    const oldPrimary = await seedChannelConfig({
      tenantId: T1,
      externalId: "OLD",
      isPrimary: true,
    });
    const newPrimary = await seedChannelConfig({
      tenantId: T1,
      externalId: "NEW",
      isPrimary: false,
    });

    await setPrimaryChannelConfig(T1, newPrimary.id);

    const db = tenantPrisma(T1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const old = await (db.channelConfig as any).findFirst({ where: { id: oldPrimary.id } }) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nw = await (db.channelConfig as any).findFirst({ where: { id: newPrimary.id } }) as any;

    expect(old!.isPrimary).toBe(false);
    expect(nw!.isPrimary).toBe(true);
  });

  it("getOutboundChannelConfig returns primary when no options given", async () => {
    await seedChannelConfig({ tenantId: T1, externalId: "NOT_PRIMARY" });
    const primary = await seedChannelConfig({
      tenantId: T1,
      externalId: "IS_PRIMARY",
      isPrimary: true,
    });

    const config = await getOutboundChannelConfig(T1);
    expect(config.id).toBe(primary.id);
  });

  it("getOutboundChannelConfig returns department-assigned config when departmentId given", async () => {
    const dept = await prisma.department.create({
      data: {
        tenantId: T1,
        name: "Goa Team",
        slug: `goa-${Date.now()}`,
      },
    });

    const goa = await seedChannelConfig({
      tenantId: T1,
      externalId: "GOA_NUM",
      departmentId: dept.id,
    });
    await seedChannelConfig({ tenantId: T1, externalId: "PRIMARY_NUM", isPrimary: true });

    const config = await getOutboundChannelConfig(T1, { departmentId: dept.id });
    expect(config.id).toBe(goa.id);
  });

  it("getOutboundChannelConfig: explicit channelConfigId wins over department", async () => {
    const dept = await prisma.department.create({
      data: {
        tenantId: T1,
        name: "Mumbai Team",
        slug: `mum-${Date.now()}`,
      },
    });
    await seedChannelConfig({
      tenantId: T1,
      externalId: "MUM_DEPT_NUM",
      departmentId: dept.id,
    });
    const explicit = await seedChannelConfig({ tenantId: T1, externalId: "EXPLICIT_NUM" });

    const config = await getOutboundChannelConfig(T1, {
      channelConfigId: explicit.id,
      departmentId: dept.id,
    });
    expect(config.id).toBe(explicit.id);
  });

  it("throws when no ChannelConfig found for tenant", async () => {
    await expect(getOutboundChannelConfig(T2)).rejects.toThrow("No active WHATSAPP");
  });
});
