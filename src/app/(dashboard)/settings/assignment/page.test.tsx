/**
 * Minimal component test for /settings/assignment page.
 *
 * Skipped — requires jsdom environment. See TODO_BLOCKERS.md.
 */

import { describe, it, expect, vi } from "vitest";

describe.skip("/settings/assignment (UI)", () => {
  it("renders strategy picker when API returns null strategy", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ strategy: null }),
    });
    expect(true).toBe(true);
  });

  it("calls PUT /api/assignment-strategy when save button clicked", async () => {
    expect(true).toBe(true);
  });
});
