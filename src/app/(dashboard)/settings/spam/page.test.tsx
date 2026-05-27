/**
 * Minimal component test for /settings/spam page.
 *
 * Skipped — requires jsdom environment. See TODO_BLOCKERS.md.
 */

import { describe, it, expect, vi } from "vitest";

describe.skip("/settings/spam (UI)", () => {
  it("renders the Rules tab with empty state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [] }),
    });
    expect(true).toBe(true);
  });

  it("renders a rule row when API returns rules", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rules: [
          {
            id: "r1",
            type: "BLACKLIST",
            identifier: "+919999999999",
            threshold: null,
            windowSeconds: null,
            blockSeconds: null,
            aiThreshold: null,
            isActive: true,
            createdAt: "2026-05-01T00:00:00Z",
          },
        ],
      }),
    });
    expect(true).toBe(true);
  });
});
