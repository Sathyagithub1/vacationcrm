// src/modules/intake/tour/waitlist-flow.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IntakePayload } from "../types";

// Mock AI provider BEFORE importing the module under test.
vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn(),
    complete: vi.fn(),
    completeJson: vi.fn().mockResolvedValue({ content: "__unset__", intent: "unknown" }),
  }),
}));

import { waitlistFlow } from "./waitlist-flow";
import { getAIProvider } from "@/modules/ai/provider";
import type { AIProviderWithClassify } from "@/modules/ai/provider";

const TENANT = "t-waitlist";
const MOCK_TOUR = { id: "tour-wl-1", name: "Bali Beach Resort 2027", code: "BALI-2027" };

function makePayload(overrides: Partial<IntakePayload> = {}): IntakePayload {
  return {
    tenantId: TENANT,
    source: "WEBSITE",
    rawPayload: {},
    sender: {},
    webhookLogId: "wh-wl-1",
    canonicalFields: { name: "Alice", notes: "I was really looking forward to this tour" },
    ...overrides,
  };
}

describe("waitlistFlow", () => {
  beforeEach(() => {
    // Reset AI mock to safe no-op before each test
    vi.mocked(getAIProvider).mockResolvedValue({
      classify: vi.fn(),
      complete: vi.fn(),
      completeJson: vi.fn().mockResolvedValue({ content: "__unset__", intent: "unknown" }),
    } as unknown as AIProviderWithClassify);
  });

  // WL-1: AI succeeds → returns content and intent
  it("generates a message and intent when AI succeeds", async () => {
    const mockProvider = await getAIProvider(TENANT);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      content: "We're sorry, this tour is sold out. We can add you to the waitlist.",
      intent: "waitlist",
    });

    const result = await waitlistFlow(makePayload(), MOCK_TOUR);

    expect(result).not.toBeNull();
    expect(result?.intent).toBe("waitlist");
    expect(result?.content).toContain("waitlist");
  });

  // WL-2: AI throws → returns null (fail-soft)
  it("returns null when AI throws", async () => {
    const mockProvider = await getAIProvider(TENANT);
    vi.mocked(mockProvider.completeJson).mockRejectedValueOnce(
      new Error("simulated AI failure")
    );

    const result = await waitlistFlow(makePayload(), MOCK_TOUR);
    expect(result).toBeNull();
  });

  // WL-3: AI returns malformed JSON (missing content) → returns null
  it("returns null when AI returns JSON missing content", async () => {
    const mockProvider = await getAIProvider(TENANT);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      intent: "alternatives",
      // content is missing
    });

    const result = await waitlistFlow(makePayload(), MOCK_TOUR);
    expect(result).toBeNull();
  });

  // WL-4: AI returns malformed JSON (missing intent) → returns null
  it("returns null when AI returns JSON missing intent", async () => {
    const mockProvider = await getAIProvider(TENANT);
    vi.mocked(mockProvider.completeJson).mockResolvedValueOnce({
      content: "We can add you to the waitlist!",
      // intent is missing
    });

    const result = await waitlistFlow(makePayload(), MOCK_TOUR);
    expect(result).toBeNull();
  });
});
