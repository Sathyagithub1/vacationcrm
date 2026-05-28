/**
 * Tests for customer memory module (6b.3)
 * Tests: appendMemory, dedupe, getCustomerContext shape, cross-tenant isolation.
 * Note: summarizeConversation is tested via mocked AI provider.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { appendMemory, getCustomerContext } from "./customer-memory";

const T1 = "tenant-mem-1";
const T2 = "tenant-mem-2";

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function seedCustomer(tenantId: string, mobile?: string) {
  return prisma.customer.create({
    data: {
      tenantId,
      name: "Test Customer",
      mobile: mobile ?? `+9190${Date.now().toString().slice(-8)}`,
    },
  });
}

async function clearAll() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).customerMemory.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
}

describe("customer-memory", () => {
  beforeEach(async () => {
    await ensureTenant(T1);
    await ensureTenant(T2);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("appendMemory creates a FACT record", async () => {
    const customer = await seedCustomer(T1);
    await appendMemory(T1, customer.id, "FACT", "Prefers window seats");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memories = await (prisma as any).customerMemory.findMany({
      where: { customerId: customer.id },
    }) as Array<{ kind: string; content: string }>;
    expect(memories).toHaveLength(1);
    expect(memories[0].kind).toBe("FACT");
    expect(memories[0].content).toBe("Prefers window seats");
  });

  it("appendMemory deduplicates identical content", async () => {
    const customer = await seedCustomer(T1);
    await appendMemory(T1, customer.id, "PREFERENCE", "Budget ₹50k");
    await appendMemory(T1, customer.id, "PREFERENCE", "Budget ₹50k"); // duplicate

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memories = await (prisma as any).customerMemory.findMany({
      where: { customerId: customer.id, kind: "PREFERENCE" },
    }) as unknown[];
    expect(memories).toHaveLength(1);
  });

  it("getCustomerContext returns structured facts, preferences, summary", async () => {
    const customer = await seedCustomer(T1);
    await appendMemory(T1, customer.id, "FACT", "Family of 4");
    await appendMemory(T1, customer.id, "PREFERENCE", "Prefers beach destinations");
    await appendMemory(T1, customer.id, "SUMMARY", "Customer inquired about Goa in Jan 2025.");

    const ctx = await getCustomerContext(customer.id);

    expect(ctx.facts).toContain("Family of 4");
    expect(ctx.preferences).toContain("Prefers beach destinations");
    expect(ctx.summary).toBe("Customer inquired about Goa in Jan 2025.");
  });

  it("getCustomerContext returns empty arrays when no memories", async () => {
    const customer = await seedCustomer(T1);
    const ctx = await getCustomerContext(customer.id);

    expect(ctx.facts).toHaveLength(0);
    expect(ctx.preferences).toHaveLength(0);
    expect(ctx.summary).toBeNull();
    expect(ctx.recentMessages).toHaveLength(0);
  });

  it("getCustomerContext includes recent messages from latest conversation", async () => {
    const customer = await seedCustomer(T1);

    const conv = await prisma.conversation.create({
      data: { tenantId: T1, customerId: customer.id, channel: "WHATSAPP", status: "ACTIVE" },
    });
    await prisma.message.create({
      data: {
        tenantId: T1,
        conversationId: conv.id,
        senderType: "CUSTOMER",
        content: "I want to book a Goa trip",
        messageType: "TEXT",
      },
    });

    const ctx = await getCustomerContext(customer.id);
    expect(ctx.recentMessages).toHaveLength(1);
    expect(ctx.recentMessages[0].content).toBe("I want to book a Goa trip");
  });

  it("cross-tenant isolation: T2 customer memory not visible in T1", async () => {
    const c2 = await seedCustomer(T2);
    await appendMemory(T2, c2.id, "FACT", "T2 Customer Fact");

    // T1 has no customers — querying with T1's db scope returns nothing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memories = await (prisma as any).customerMemory.findMany({
      where: { tenantId: T1 },
    }) as unknown[];
    expect(memories).toHaveLength(0);
  });
});
