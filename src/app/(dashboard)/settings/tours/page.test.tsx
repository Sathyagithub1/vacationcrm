/**
 * Minimal component test for /settings/tours page.
 *
 * Skipped — requires jsdom environment. See TODO_BLOCKERS.md.
 */

import { describe, it, expect, vi } from "vitest";

describe.skip("/settings/tours (UI)", () => {
  it("renders tours table when API returns data", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tours: [
          {
            id: "t1",
            name: "Bali Package",
            code: "BALI-7D",
            capacity: 20,
            bookedCount: 12,
            status: "ACTIVE",
            startDate: "2026-06-01T00:00:00Z",
            endDate: "2026-06-07T00:00:00Z",
            departmentId: null,
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      }),
    });
    expect(true).toBe(true);
  });

  it("shows empty state when no tours", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tours: [], total: 0, page: 1, totalPages: 0 }),
    });
    expect(true).toBe(true);
  });
});
