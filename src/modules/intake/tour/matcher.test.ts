// src/modules/intake/tour/matcher.test.ts

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";

// Mock AI provider BEFORE importing module under test.
// Default: completeJson returns low confidence so it's a safe no-op.
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue({ tourId: "__unset__", confidence: 0 }),
  }),
}));

import { matchTour } from "./matcher";
import { getAIProvider } from "@/modules/ai/provider";
import type { AIProviderWithClassify } from "@/modules/ai/provider";

// ── Constants ────────────────────────────────────────────────────────────────
const T = "t-tour-matcher";
const DEPT_ID = "dept-tour-matcher";
const TOUR_ACTIVE_ID = "tour-active-matcher";
const TOUR_SOLD_ID = "tour-sold-matcher";

// ── Fixture helpers ──────────────────────────────────────────────────────────
async function ensureTenant(id: string) {
  await prisma.tenant.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id },
  });
}

async function ensureDepartment(id: string, tenantId: string) {
  await prisma.department.upsert({
    where: { id },
    update: {},
    create: { id, tenantId, name: "Tours Dept", slug: id },
  });
}

async function seedTour(opts: {
  id: string;
  tenantId: string;
  code: string;
  departmentId: string;
  status?: "ACTIVE" | "SOLD_OUT" | "DRAFT";
  capacity?: number;
  sold?: number;
  tagIds?: string[];
}) {
  return prisma.tour.upsert({
    where: { id: opts.id },
    update: {},
    create: {
      id: opts.id,
      tenantId: opts.tenantId,
      code: opts.code,
      name: `Tour ${opts.code}`,
      description: `Description for ${opts.code}. Bali beach luxury resort package.`,
      departmentId: opts.departmentId,
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-01-08"),
      capacity: opts.capacity ?? 20,
      sold: opts.sold ?? 0,
      status: opts.status ?? "ACTIVE",
      tagIds: opts.tagIds ?? [],
    },
  });
}

async function clearAll() {
  await prisma.tour.deleteMany({ where: { tenantId: T } });
  await prisma.department.deleteMany({ where: { tenantId: T } });
}

function makePayload(overrides: Partial<IntakePayload> = {}): IntakePayload {
  return {
    tenantId: T,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-tour-matcher-1",
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(async () => {
  await ensureTenant(T);
  await clearAll();
  await ensureDepartment(DEPT_ID, T);
  await seedTour({
    id: TOUR_ACTIVE_ID,
    tenantId: T,
    code: "BALI-2027",
    departmentId: DEPT_ID,
    status: "ACTIVE",
    capacity: 20,
    tagIds: ["tag-bali", "tag-beach"],
  });
  await seedTour({
    id: TOUR_SOLD_ID,
    tenantId: T,
    code: "PARIS-2027",
    departmentId: DEPT_ID,
    status: "SOLD_OUT",
    capacity: 10,
    sold: 10,
    tagIds: ["tag-paris", "tag-europe"],
  });

  // Reset AI mock to safe no-op before each test
  vi.mocked(getAIProvider).mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue({ tourId: "__unset__", confidence: 0 }),
  } as unknown as AIProviderWithClassify);
});

afterAll(async () => {
  await clearAll();
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("matchTour", () => {
  // T1: Explicit tourCode hit — ACTIVE tour
  it("explicit tourCode matches active tour → confidence 1, soldOut false, merges tagIds", async () => {
    const payload = makePayload({
      canonicalFields: { tourCode: "BALI-2027", tags: ["tag-existing"] },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch?.tourId).toBe(TOUR_ACTIVE_ID);
    expect(out.tourMatch?.confidence).toBe(1);
    expect(out.tourMatch?.soldOut).toBe(false);
    // tagIds from tour merged with existing tags, deduped
    expect(out.canonicalFields?.tags).toEqual(
      expect.arrayContaining(["tag-existing", "tag-bali", "tag-beach"])
    );
  });

  // T2: Explicit tourCode hit — SOLD_OUT tour maps soldOut: true
  it("explicit tourCode matches sold-out tour → soldOut true, confidence 1", async () => {
    const payload = makePayload({
      canonicalFields: { tourCode: "PARIS-2027" },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch?.tourId).toBe(TOUR_SOLD_ID);
    expect(out.tourMatch?.confidence).toBe(1);
    expect(out.tourMatch?.soldOut).toBe(true);
  });

  // T3: Explicit tourCode no match → falls through to AI (AI is mocked to low-conf → no tourMatch)
  it("explicit tourCode with no matching row → falls through to AI tier, AI low-conf → no tourMatch", async () => {
    const payload = makePayload({
      canonicalFields: { tourCode: "NONEXISTENT-CODE", notes: "I want to go somewhere" },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch).toBeUndefined();
  });

  // T4: AI returns tourId with confidence >= 0.8 AND in catalog → accepted, tagIds merged
  it("AI returns tourId with confidence >= 0.8 and id in catalog → accepted with merged tagIds", async () => {
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      tourId: TOUR_ACTIVE_ID,
      confidence: 0.9,
    });

    const payload = makePayload({
      canonicalFields: {
        notes: "Looking for a luxury beach holiday in Bali",
        tags: ["tag-existing"],
      },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch?.tourId).toBe(TOUR_ACTIVE_ID);
    expect(out.tourMatch?.confidence).toBe(0.9);
    expect(out.tourMatch?.soldOut).toBe(false);
    expect(out.canonicalFields?.tags).toEqual(
      expect.arrayContaining(["tag-existing", "tag-bali", "tag-beach"])
    );
  });

  // T5: AI returns confidence < 0.8 → no tourMatch
  it("AI returns confidence < 0.8 → tourMatch undefined", async () => {
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      tourId: TOUR_ACTIVE_ID,
      confidence: 0.7,
    });

    const payload = makePayload({
      canonicalFields: { notes: "Maybe I want to go to Bali" },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch).toBeUndefined();
  });

  // T6: AI throws → fail-soft, returns payload unchanged
  it("AI throws → fail-soft, returns payload unchanged", async () => {
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockRejectedValueOnce(
      new Error("simulated AI failure")
    );

    const payload = makePayload({
      canonicalFields: { notes: "I want to travel somewhere nice" },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch).toBeUndefined();
    expect(out.canonicalFields?.tags).toBeUndefined();
  });

  // T7: AI returns tourId NOT in catalog → rejected (anti-hallucination guard)
  it("AI returns tourId not in loaded catalog → rejected, tourMatch undefined", async () => {
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      tourId: "tour-hallucinated-id-not-real",
      confidence: 0.95,
    });

    const payload = makePayload({
      canonicalFields: { notes: "I want to book a tour" },
    });
    const out = await matchTour(payload);

    expect(out.tourMatch).toBeUndefined();
  });
});
