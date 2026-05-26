// src/modules/intake/normalize/language-detect.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    complete: vi.fn().mockImplementation(async (prompt: string) => {
      if (prompt.includes("मुझे")) return "hi";
      if (prompt.includes("FAIL_NOW")) throw new Error("upstream blew up");
      if (prompt.includes("GIBBERISH_TOKEN")) return "this is not a code";
      return "en";
    }),
  }),
}));

import { detectLanguage } from "./language-detect";

describe("detectLanguage", () => {
  it("returns ISO 639-1 code via AI", async () => {
    expect(await detectLanguage("t1", "मुझे गोवा जाना है")).toBe("hi");
    expect(await detectLanguage("t1", "hello sir, planning a trip")).toBe("en");
  });

  it("returns undefined for empty/whitespace input", async () => {
    expect(await detectLanguage("t1", "")).toBeUndefined();
    expect(await detectLanguage("t1", "   ")).toBeUndefined();
  });

  it("returns undefined when the AI throws", async () => {
    expect(await detectLanguage("t1", "FAIL_NOW please")).toBeUndefined();
  });

  it("returns undefined when the response is not a 2-letter code", async () => {
    expect(await detectLanguage("t1", "GIBBERISH_TOKEN here")).toBeUndefined();
  });
});
