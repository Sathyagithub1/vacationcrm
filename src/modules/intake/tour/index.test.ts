// src/modules/intake/tour/index.test.ts

/**
 * Integration tests for the tour stage orchestrator (T22).
 *
 * Uses real `matchTour` against seeded DB data. Only the AI provider is
 * mocked — matching the integration-test pattern used throughout this
 * codebase (e.g. department/resolve.test.ts).
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { IntakePayload } from "../types";

// Mock AI provider BEFORE importing the module under test.
// Default: low confidence so tests that don't need AI don't accidentally match.
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue({ tourId: "__unset__", confidence: 0 }),
  }),
}));

import { processTour } from "./index";
import { getAIProvider } from "@/modules/ai/provider";
import type { AIProviderWithClassify } from "@/modules/ai/provider";

// ── Constants ─────────────────────────────────────────────────────────────────
const T = "t-tour-orch";
const DEPT_ID = "dept-tour-orch";
const TOUR_ACTIVE_ID = "tour-orch-active";
const TOUR_SOLD_ID = "tour-orch-sold";

// ── Fixture helpers ───────────────────────────────────────────────────────────
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
    create: { id, tenantId, name: "Tour Dept", slug: id },
  });
}

async function clearAll() {
  await prisma.tour.deleteMany({ where: { tenantId: T } });
  await prisma.department.deleteMany({ where: { tenantId: T } });
}

async function seedTours() {
  await prisma.tour.upsert({
    where: { id: TOUR_ACTIVE_ID },
    update: {},
    create: {
      id: TOUR_ACTIVE_ID,
      tenantId: T,
      code: "BALI-ORCH",
      name: "Bali Active Tour",
      description: "Active beach holiday",
      departmentId: DEPT_ID,
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-01-08"),
      capacity: 20,
      sold: 0,
      status: "ACTIVE",
      tagIds: ["tag-orch-active"],
    },
  });
  await prisma.tour.upsert({
    where: { id: TOUR_SOLD_ID },
    update: {},
    create: {
      id: TOUR_SOLD_ID,
      tenantId: T,
      code: "PARIS-ORCH",
      name: "Paris Sold Out Tour",
      description: "Romantic Paris getaway",
      departmentId: DEPT_ID,
      startDate: new Date("2027-02-01"),
      endDate: new Date("2027-02-08"),
      capacity: 5,
      sold: 5,
      status: "SOLD_OUT",
      tagIds: ["tag-orch-sold"],
    },
  });
}

function makePayload(overrides: Partial<IntakePayload> = {}): IntakePayload {
  return {
    tenantId: T,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-tour-orch-1",
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeEach(async () => {
  await ensureTenant(T);
  await clearAll();
  await ensureDepartment(DEPT_ID, T);
  await seedTours();

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

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("processTour (orchestrator)", () => {

  // O-1: No tour match → payload returned unchanged
  it("no tour match → returns payload unchanged (no tourMatch, no priority, no outboundMessage)", async () => {
    // AI returns low confidence → no match; no explicit tourCode
    const payload = makePayload({
      canonicalFields: { notes: "general travel inquiry" },
    });
    const out = await processTour(payload);

    expect(out.tourMatch).toBeUndefined();
    expect(out.priority).toBeUndefined();
    expect(out.outboundMessage).toBeUndefined();
  });

  // O-2: Tour match, NOT sold out → tourMatch set, no priority, no outboundMessage
  it("tour match, not sold out → sets tourMatch only, no priority, no outboundMessage", async () => {
    const payload = makePayload({
      canonicalFields: { tourCode: "BALI-ORCH" },
    });
    const out = await processTour(payload);

    expect(out.tourMatch?.tourId).toBe(TOUR_ACTIVE_ID);
    expect(out.tourMatch?.soldOut).toBe(false);
    expect(out.priority).toBeUndefined();
    expect(out.outboundMessage).toBeUndefined();
  });

  // O-3: Tour match, sold out → sold-out tag, priority HIGH, outboundMessage staged
  it("tour match, sold out → adds sold-out tag, sets priority HIGH, stages outboundMessage", async () => {
    // Waitlist AI returns a real message
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      content: "We're sorry, PARIS-ORCH is sold out. We can add you to the waitlist.",
      intent: "waitlist",
    });

    const payload = makePayload({
      canonicalFields: {
        tourCode: "PARIS-ORCH",
        notes: "I want to book the Paris tour",
        tags: ["tag-existing"],
      },
    });
    const out = await processTour(payload);

    expect(out.tourMatch?.tourId).toBe(TOUR_SOLD_ID);
    expect(out.tourMatch?.soldOut).toBe(true);
    expect(out.priority).toBe("HIGH");
    expect(out.canonicalFields?.tags).toEqual(
      expect.arrayContaining(["sold-out", "tag-existing", "tag-orch-sold"])
    );
    expect(out.outboundMessage).toBeDefined();
    expect(out.outboundMessage?.intent).toBe("waitlist");
    expect(typeof out.outboundMessage?.content).toBe("string");
  });

  // O-4: Tour match, sold out, waitlist-flow fails → tag + priority set, outboundMessage undefined
  it("tour match, sold out, waitlist-flow fails → still sets tag + priority, outboundMessage undefined", async () => {
    // First completeJson call is from matchTour (explicit tourCode — won't call AI)
    // The waitlistFlow call uses completeJson — make that throw
    const mockProvider = await getAIProvider(T);
    vi.mocked(mockProvider.completeJson).mockRejectedValueOnce(
      new Error("waitlist AI failure")
    );

    const payload = makePayload({
      canonicalFields: { tourCode: "PARIS-ORCH" },
    });
    const out = await processTour(payload);

    expect(out.tourMatch?.soldOut).toBe(true);
    expect(out.priority).toBe("HIGH");
    expect(out.canonicalFields?.tags).toContain("sold-out");
    expect(out.outboundMessage).toBeUndefined();
  });
});
