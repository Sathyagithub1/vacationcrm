// src/modules/intake/normalize/field-map.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    completeJson: vi.fn().mockResolvedValue({
      full_name: "name",
      mobile_no: "phone",
      email: "email",
    }),
  }),
}));

import { proposeFieldMap, applyFieldMap, detectUnknownKeys } from "./field-map";

describe("proposeFieldMap", () => {
  it("asks AI to map raw keys to canonical keys", async () => {
    const map = await proposeFieldMap("t1", {
      full_name: "Joe",
      mobile_no: "+91",
      email: "x@y.com",
    });
    expect(map).toEqual({
      full_name: "name",
      mobile_no: "phone",
      email: "email",
    });
  });
});

describe("applyFieldMap", () => {
  it("produces canonical fields from raw via map", () => {
    const c = applyFieldMap(
      { full_name: "Joe", mobile_no: "+91", email: "x@y.com" },
      { full_name: "name", mobile_no: "phone", email: "email" }
    );
    expect(c).toEqual({ name: "Joe", phone: "+91", email: "x@y.com" });
  });

  it("skips mapped source keys not present in raw", () => {
    const c = applyFieldMap(
      { full_name: "Joe" },
      { full_name: "name", mobile_no: "phone" }
    );
    expect(c).toEqual({ name: "Joe" });
  });
});

describe("detectUnknownKeys", () => {
  it("flags payload keys not present in fieldMap", () => {
    const u = detectUnknownKeys({ name: "a", city: "b" }, { name: "name" });
    expect(u).toEqual(["city"]);
  });

  it("returns empty when all keys are mapped", () => {
    const u = detectUnknownKeys(
      { name: "a", phone: "b" },
      { name: "name", phone: "phone" }
    );
    expect(u).toEqual([]);
  });
});
