/**
 * Tests for broadcast audience module (6b.2)
 * Tests: preview audience, tag filter intersection, customer vs lead scope,
 * cross-tenant isolation, empty tag list.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { previewAudience, expandAudience } from "./audience";

const T1 = "tenant-aud-1";
const T2 = "tenant-aud-2";

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function seedCustomerWithTags(tenantId: string, name: string, tagIds: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.customer as any).create({
    data: { tenantId, name, mobile: `+91${Date.now()}${Math.random().toString().slice(2, 7)}`, tagIds },
  });
}

async function seedTag(tenantId: string, name: string) {
  return prisma.tag.create({
    data: { tenantId, name, scope: "CUSTOMER" },
  });
}

async function clearAll() {
  await prisma.broadcastRecipient.deleteMany({ where: { broadcast: { tenantId: { in: [T1, T2] } } } });
  await prisma.broadcast.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.tag.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
}

describe("broadcast audience", () => {
  beforeEach(async () => {
    await ensureTenant(T1);
    await ensureTenant(T2);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("previewAudience returns correct count for CUSTOMER scope", async () => {
    const tag = await seedTag(T1, "goa");
    await seedCustomerWithTags(T1, "Alice", [tag.id]);
    await seedCustomerWithTags(T1, "Bob", [tag.id]);
    await seedCustomerWithTags(T1, "Charlie", []); // no tag

    const preview = await previewAudience(T1, [tag.id], "CUSTOMER");
    expect(preview.count).toBe(2);
    expect(preview.sampleCustomers).toHaveLength(2);
  });

  it("previewAudience with empty tagIds returns all customers", async () => {
    await seedCustomerWithTags(T1, "A", []);
    await seedCustomerWithTags(T1, "B", []);

    const preview = await previewAudience(T1, [], "CUSTOMER");
    expect(preview.count).toBeGreaterThanOrEqual(2);
  });

  it("tag intersection: customer must have ALL tags", async () => {
    const t1 = await seedTag(T1, "beach");
    const t2 = await seedTag(T1, "family");

    await seedCustomerWithTags(T1, "OnlyBeach", [t1.id]);         // only beach
    await seedCustomerWithTags(T1, "Both", [t1.id, t2.id]);       // both tags
    await seedCustomerWithTags(T1, "Neither", []);                  // neither

    const preview = await previewAudience(T1, [t1.id, t2.id], "CUSTOMER");
    expect(preview.count).toBe(1);
    expect(preview.sampleCustomers[0].name).toBe("Both");
  });

  it("expandAudience returns customerId+channels for matching customers", async () => {
    const tag = await seedTag(T1, "vip");
    const c = await seedCustomerWithTags(T1, "VIPCustomer", [tag.id]);

    const recipients = await expandAudience(T1, [tag.id], "CUSTOMER");
    expect(recipients).toHaveLength(1);
    expect(recipients[0].customerId).toBe(c.id);
    expect(recipients[0].channels.mobile).toBeTruthy();
  });

  it("cross-tenant isolation: tags from T2 do not appear in T1 audience", async () => {
    const tag = await seedTag(T2, "t2tag");
    await seedCustomerWithTags(T2, "T2Customer", [tag.id]);

    // T1 has no customers with that tag
    const preview = await previewAudience(T1, [tag.id], "CUSTOMER");
    expect(preview.count).toBe(0);
  });

  it("previewAudience with unknown tag returns zero", async () => {
    const preview = await previewAudience(T1, ["nonexistent-tag-id"], "CUSTOMER");
    expect(preview.count).toBe(0);
  });
});
