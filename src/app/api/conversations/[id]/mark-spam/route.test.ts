/**
 * src/app/api/conversations/[id]/mark-spam/route.test.ts
 *
 * T41 tests — Mark-as-spam endpoint.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const mockSession = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(() => mockSession.value) }));

import { POST } from "./route";

const T_ADMIN = "t-mspam-admin";
const T_VIEWER = "t-mspam-viewer";

function setSession(tenantId: string, role: string) {
  mockSession.value = {
    user: { id: `u-${tenantId}`, email: `u@${tenantId}.com`, name: "U", role, tenantId },
  };
}

async function seedConversationWithCustomer(tenantId: string, mobile: string): Promise<{
  conversationId: string;
  customerId: string;
}> {
  const customer = await prisma.customer.create({
    data: { tenantId, name: "Spam Sender", mobile },
  });

  const stageId = `stage-mspam-${tenantId}`;
  await prisma.pipelineStage.upsert({
    where: { id: stageId }, update: {},
    create: { id: stageId, tenantId, name: "New", slug: "new", position: 1, isDefault: true },
  });

  const lead = await prisma.lead.create({
    data: { tenantId, customerId: customer.id, stageId, source: "WHATSAPP" },
  });

  const conv = await prisma.conversation.create({
    data: { tenantId, customerId: customer.id, leadId: lead.id, channel: "WHATSAPP", status: "ACTIVE" },
  });

  return { conversationId: conv.id, customerId: customer.id };
}

async function clearTenant(t: string) {
  await prisma.spamRule.deleteMany({ where: { tenantId: t } });
  await prisma.message.deleteMany({ where: { tenantId: t } });
  await prisma.conversation.deleteMany({ where: { tenantId: t } });
  await prisma.leadActivity.deleteMany({ where: { tenantId: t } });
  await prisma.lead.deleteMany({ where: { tenantId: t } });
  await prisma.customer.deleteMany({ where: { tenantId: t } });
  await prisma.pipelineStage.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
}

function postReq(convId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/conversations/${convId}/mark-spam`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(convId: string) {
  return { params: Promise.resolve({ id: convId }) };
}

beforeEach(async () => {
  for (const t of [T_ADMIN, T_VIEWER]) {
    await prisma.tenant.upsert({ where: { id: t }, update: {}, create: { id: t, name: t, slug: t } });
    await clearTenant(t);
    await prisma.user.upsert({
      where: { id: `u-${t}` }, update: {},
      create: { id: `u-${t}`, tenantId: t, email: `u@${t}.com`, passwordHash: "x", name: "Admin", role: t === T_VIEWER ? "VIEWER" : "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
  }
  mockSession.value = null;
});

afterAll(async () => {
  for (const t of [T_ADMIN, T_VIEWER]) await clearTenant(t);
  await prisma.$disconnect();
});

describe("T41 POST /api/conversations/[id]/mark-spam", () => {

  it("happy path: creates BLACKLIST SpamRule with channels + departmentIds, closes conversations", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const { conversationId, customerId } = await seedConversationWithCustomer(T_ADMIN, "+919911000001");

    const res = await POST(
      postReq(conversationId, { channels: ["WHATSAPP"], departmentIds: [], reason: "Abusive sender" }),
      makeCtx(conversationId),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    const rule = json.rule as Record<string, unknown>;

    // SpamRule created with BLACKLIST + scopes
    expect(rule.type).toBe("BLACKLIST");
    expect(rule.identifier).toBe("+919911000001");
    expect((rule.channels as string[]).includes("WHATSAPP")).toBe(true);

    // Conversation must be closed
    const conv = await prisma.conversation.findFirst({ where: { customerId } });
    expect(conv?.status).toBe("CLOSED");
  });

  it("returns 404 when conversation not found", async () => {
    setSession(T_ADMIN, "COMPANY_ADMIN");
    const res = await POST(
      postReq("non-existent-conv-id", { channels: [], departmentIds: [] }),
      makeCtx("non-existent-conv-id"),
    );
    expect(res.status).toBe(404);
  });

  it("VIEWER role → 403", async () => {
    setSession(T_VIEWER, "VIEWER");
    // No need to seed a real conversation — 403 should be returned before DB access
    await prisma.user.upsert({
      where: { id: `u-${T_VIEWER}` }, update: { role: "VIEWER" },
      create: { id: `u-${T_VIEWER}`, tenantId: T_VIEWER, email: `u@${T_VIEWER}.com`, passwordHash: "x", name: "Viewer", role: "VIEWER", isActive: true, languages: [], tags: [] },
    });
    const res = await POST(
      postReq("any-id", { channels: [], departmentIds: [] }),
      makeCtx("any-id"),
    );
    expect(res.status).toBe(403);
  });

  it("tenant isolation: cannot mark-spam a conversation belonging to another tenant", async () => {
    // Seed conversation in T_ADMIN
    const { conversationId } = await seedConversationWithCustomer(T_ADMIN, "+919911000002");

    // Switch to T_VIEWER (admin of their own tenant)
    await prisma.user.upsert({
      where: { id: `u-${T_VIEWER}` }, update: { role: "COMPANY_ADMIN" },
      create: { id: `u-${T_VIEWER}`, tenantId: T_VIEWER, email: `u@${T_VIEWER}.com`, passwordHash: "x", name: "Admin2", role: "COMPANY_ADMIN", isActive: true, languages: [], tags: [] },
    });
    setSession(T_VIEWER, "COMPANY_ADMIN");

    // tenantPrisma scopes conversation to T_VIEWER — not found
    const res = await POST(
      postReq(conversationId, { channels: [], departmentIds: [] }),
      makeCtx(conversationId),
    );
    expect(res.status).toBe(404);
  });
});
