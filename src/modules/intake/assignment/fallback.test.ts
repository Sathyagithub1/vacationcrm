// src/modules/intake/assignment/fallback.test.ts

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { fallbackAssign } from "./fallback";

// ── Constants ──────────────────────────────────────────────────────────────────
const T1 = "t-fb-1"; // eligible agents exist → dept-rr
const T2 = "t-fb-2"; // no eligible agents, COMPANY_ADMIN exists → admin + notifications
const T3 = "t-fb-3"; // no eligible agents, no admin → throws
const DEPT = "dept-fb-1";

// ── Helpers ────────────────────────────────────────────────────────────────────
async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function ensureDept(id: string, tenantId: string) {
  await prisma.department.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: id, slug: id },
  });
}

let userSeq = 0;
async function createUser(opts: {
  tenantId: string;
  role: "AGENT" | "COMPANY_ADMIN";
  departmentId?: string;
  isActive?: boolean;
}): Promise<string> {
  const seq = ++userSeq;
  const id = `user-fb-${seq}`;
  await prisma.user.create({
    data: {
      id,
      tenantId: opts.tenantId,
      email: `user-fb-${seq}@test.com`,
      passwordHash: "x",
      name: `User FB ${seq}`,
      role: opts.role,
      isActive: opts.isActive ?? true,
      departmentId: opts.departmentId ?? null,
      languages: [],
      tags: [],
    },
  });
  return id;
}

async function clearAll() {
  for (const t of [T1, T2, T3]) {
    await prisma.assignmentCursor.deleteMany({ where: { tenantId: t } });
    await prisma.notification.deleteMany({ where: { tenantId: t } });
    await prisma.user.deleteMany({ where: { tenantId: t } });
    await prisma.department.deleteMany({ where: { tenantId: t } });
  }
}

describe("fallbackAssign", () => {
  beforeEach(async () => {
    for (const t of [T1, T2, T3]) await ensureTenant(t);
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
    await prisma.$disconnect();
  });

  it("eligible agents exist → returns one with reason fallback:dept-rr", async () => {
    await ensureDept(DEPT, T1);
    const agentId = await createUser({ tenantId: T1, role: "AGENT", departmentId: DEPT });

    const result = await fallbackAssign(T1, DEPT);
    expect(result.agentId).toBe(agentId);
    expect(result.reason).toBe("fallback:dept-rr");
  });

  it("no eligible agents, COMPANY_ADMIN exists → returns admin id with reason fallback:company-admin and fans notifications to all admins", async () => {
    // No AGENTs in T2; two COMPANY_ADMINs — admin1 is explicitly older so the
    // orderBy: createdAt ASC query must deterministically pick it first.
    const admin1 = await prisma.user.create({
      data: {
        id: `user-fb-${++userSeq}`,
        tenantId: T2,
        email: `user-fb-${userSeq}@test.com`,
        passwordHash: "x",
        name: `User FB ${userSeq}`,
        role: "COMPANY_ADMIN",
        isActive: true,
        departmentId: null,
        languages: [],
        tags: [],
        createdAt: new Date("2026-01-01"),
      },
    }).then((u) => u.id);
    const admin2 = await prisma.user.create({
      data: {
        id: `user-fb-${++userSeq}`,
        tenantId: T2,
        email: `user-fb-${userSeq}@test.com`,
        passwordHash: "x",
        name: `User FB ${userSeq}`,
        role: "COMPANY_ADMIN",
        isActive: true,
        departmentId: null,
        languages: [],
        tags: [],
        createdAt: new Date("2026-01-02"),
      },
    }).then((u) => u.id);

    const result = await fallbackAssign(T2, DEPT);

    // Must return the first (earliest createdAt) admin — not just either one.
    expect(result.agentId).toBe(admin1);
    expect(result.reason).toBe("fallback:company-admin");

    // Both admins should have received a notification
    const notifications = await prisma.notification.findMany({
      where: { tenantId: T2, type: "ASSIGNMENT_FALLBACK" },
      select: { userId: true },
    });
    const notifiedIds = notifications.map((n) => n.userId).sort();
    expect(notifiedIds).toEqual([admin1, admin2].sort());
  });

  it("no eligible agents, no COMPANY_ADMIN → throws with tenantId in message", async () => {
    // Seed an inactive admin to confirm inactive is excluded
    await createUser({ tenantId: T3, role: "COMPANY_ADMIN", isActive: false });

    await expect(fallbackAssign(T3, DEPT)).rejects.toThrow(T3);
  });
});
