// src/modules/intake/spam/ai-classifier.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { redis } from "@/lib/redis";

vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn().mockImplementation(async (text: string) => {
      if (text.toLowerCase().includes("viagra")) {
        return { isSpam: true, confidence: 0.98 };
      }
      return { isSpam: false, confidence: 0.1 };
    }),
  }),
}));

import { checkAi } from "./ai-classifier";

describe("checkAi", () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.flushdb();
  });

  it("blocks when confidence >= threshold", async () => {
    const r = await checkAi({
      tenantId: "t1",
      text: "buy viagra cheap",
      threshold: 0.95,
    });
    expect(r.blocked).toBe(true);
  });

  it("does not block when confidence < threshold", async () => {
    const r = await checkAi({
      tenantId: "t1",
      text: "hello sir",
      threshold: 0.95,
    });
    expect(r.blocked).toBe(false);
  });

  it("returns false safely when AI fails", async () => {
    const r = await checkAi({
      tenantId: "t1",
      text: "crash",
      threshold: 0.95,
      _forceFail: true,
    });
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(true);
  });
});
