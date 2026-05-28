/**
 * Tests for auto-escalation rules engine (6b.4)
 * Tests: rule evaluation, threshold rule fires after N messages,
 * booking-signal bypasses rule, duration rule, escalate assigns to senior,
 * park sends message, cross-tenant isolation.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateConversation } from "./auto-escalate";

const T1 = "tenant-esc-1";
const T2 = "tenant-esc-2";

async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function seedStage(tenantId: string) {
  const id = `stage-esc-${tenantId}-${Date.now()}`;
  await prisma.pipelineStage.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: "New", slug: `new-${id}`, position: 0, isDefault: true },
  });
  return id;
}

async function seedUser(tenantId: string, role: string, name: string) {
  const id = `user-esc-${tenantId}-${role}-${Date.now()}`;
  return prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      tenantId,
      email: `${id}@test.com`,
      passwordHash: "hash",
      name,
      role: role as "AGENT" | "DEPT_MANAGER" | "COMPANY_ADMIN",
      isActive: true,
    },
  });
}

async function seedConversation(tenantId: string, customerId: string, agentId?: string) {
  return prisma.conversation.create({
    data: {
      tenantId,
      customerId,
      channel: "WHATSAPP",
      status: "ACTIVE",
      assignedAgentId: agentId ?? null,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
  });
}

async function seedCustomer(tenantId: string) {
  return prisma.customer.create({
    data: {
      tenantId,
      name: "Test Customer",
      mobile: `+9199${Date.now().toString().slice(-8)}`,
    },
  });
}

async function seedMessages(tenantId: string, conversationId: string, count: number, content = "just checking prices") {
  const creates = Array.from({ length: count }, (_, i) =>
    prisma.message.create({
      data: {
        tenantId,
        conversationId,
        senderType: "CUSTOMER",
        content: `${content} ${i + 1}`,
        messageType: "TEXT",
      },
    })
  );
  for (const c of creates) await c;
}

async function seedEscalationRule(
  tenantId: string,
  type: string,
  config: object,
  action: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma as any).escalationRule.create({
    data: {
      tenantId,
      name: `Test Rule ${type}`,
      type,
      config,
      action,
      isActive: true,
    },
  });
}

async function clearAll() {
  await prisma.notification.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).escalationRule.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.escalation.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
}

describe("auto-escalate", () => {
  beforeEach(async () => {
    await ensureTenant(T1);
    await ensureTenant(T2);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("returns null when no escalation rules configured", async () => {
    const customer = await seedCustomer(T1);
    const conv = await seedConversation(T1, customer.id);
    await seedMessages(T1, conv.id, 5);

    const result = await evaluateConversation(conv.id);
    expect(result).toBeNull();
  });

  it("MESSAGE_COUNT_THRESHOLD: fires after reaching threshold", async () => {
    await seedEscalationRule(
      T1,
      "MESSAGE_COUNT_THRESHOLD",
      { threshold: 3, windowHours: 24, bookingSignals: ["book", "pay", "confirm"] },
      "NOTIFY"
    );
    const manager = await seedUser(T1, "DEPT_MANAGER", "Manager One");
    const customer = await seedCustomer(T1);
    const conv = await seedConversation(T1, customer.id);
    await seedMessages(T1, conv.id, 3, "just browsing");

    const result = await evaluateConversation(conv.id);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("NOTIFY");
  });

  it("MESSAGE_COUNT_THRESHOLD: booking signal keyword bypasses rule", async () => {
    await seedEscalationRule(
      T1,
      "MESSAGE_COUNT_THRESHOLD",
      { threshold: 3, windowHours: 24, bookingSignals: ["confirm", "book", "pay"] },
      "NOTIFY"
    );
    const customer = await seedCustomer(T1);
    const conv = await seedConversation(T1, customer.id);

    // Messages contain "book" — should not escalate
    await seedMessages(T1, conv.id, 5, "I want to book this tour");

    const result = await evaluateConversation(conv.id);
    expect(result).toBeNull();
  });

  it("DURATION rule fires when conversation exceeds maxHours", async () => {
    await seedEscalationRule(T1, "DURATION", { maxHours: 1 }, "NOTIFY");
    const manager = await seedUser(T1, "DEPT_MANAGER", "Manager Two");
    const customer = await seedCustomer(T1);

    // Create conversation that started 2 hours ago
    const conv = await prisma.conversation.create({
      data: {
        tenantId: T1,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: "ACTIVE",
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });

    const result = await evaluateConversation(conv.id);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("NOTIFY");
  });

  it("ESCALATE action assigns conversation to senior agent", async () => {
    const stageId = await seedStage(T1);
    const agent = await seedUser(T1, "AGENT", "Junior Agent");
    const manager = await seedUser(T1, "DEPT_MANAGER", "Senior Manager");

    await seedEscalationRule(
      T1,
      "MESSAGE_COUNT_THRESHOLD",
      { threshold: 2, windowHours: 24, bookingSignals: [] },
      "ESCALATE"
    );

    const customer = await seedCustomer(T1);
    const conv = await seedConversation(T1, customer.id, agent.id);
    await seedMessages(T1, conv.id, 3, "just looking around");

    await evaluateConversation(conv.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma.conversation as any).findUnique({ where: { id: conv.id } }) as any;
    expect(updated!.escalatedAt).not.toBeNull();
    expect(updated!.assignedAgentId).toBe(manager.id);
  });

  it("PARK action creates a polite message and closes conversation", async () => {
    await seedEscalationRule(
      T1,
      "DURATION",
      { maxHours: 0.001 }, // Near zero — always fires
      "PARK"
    );

    const customer = await seedCustomer(T1);
    const conv = await prisma.conversation.create({
      data: {
        tenantId: T1,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: "ACTIVE",
        // startedAt 1 hour ago — well past maxHours: 0.001 (≈ 3.6 seconds)
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await evaluateConversation(conv.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma.conversation as any).findUnique({ where: { id: conv.id } }) as any;
    expect(updated!.status).toBe("CLOSED");
    expect(updated!.escalationReason).toContain("Parked");

    const msgs = await prisma.message.findMany({ where: { conversationId: conv.id } });
    const botMsg = msgs.find((m) => m.senderType === "BOT");
    expect(botMsg).toBeDefined();
    expect(botMsg!.content).toContain("follow up");
  });

  it("does not re-evaluate an already-escalated conversation", async () => {
    await seedEscalationRule(
      T1,
      "DURATION",
      { maxHours: 0.001 },
      "PARK"
    );

    const customer = await seedCustomer(T1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conv = await (prisma.conversation as any).create({
      data: {
        tenantId: T1,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: "ACTIVE",
        startedAt: new Date(Date.now() - 100),
        escalatedAt: new Date(), // Already escalated
      },
    }) as { id: string };

    const result = await evaluateConversation(conv.id);
    expect(result).toBeNull(); // Should be skipped
  });

  it("cross-tenant: T1 rules do not affect T2 conversations", async () => {
    await seedEscalationRule(
      T1,
      "DURATION",
      { maxHours: 0.001 },
      "NOTIFY"
    );

    // T2 has no rules
    const customer2 = await seedCustomer(T2);
    const conv2 = await prisma.conversation.create({
      data: {
        tenantId: T2,
        customerId: customer2.id,
        channel: "WHATSAPP",
        status: "ACTIVE",
        startedAt: new Date(Date.now() - 100),
      },
    });

    const result = await evaluateConversation(conv2.id);
    expect(result).toBeNull(); // T2 has no rules
  });
});
