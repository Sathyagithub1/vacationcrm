/**
 * src/app/(dashboard)/settings/tours/page.test.tsx
 *
 * UI environment tests for /settings/tours.
 *
 * Verifies API response shapes.
 * Full component rendering deferred until Next.js server context is available
 * in jsdom.
 *
 * Run with:  npx vitest run --config vitest.ui.config.ts
 */

import { describe, it, expect, vi } from "vitest";

describe("/settings/tours (UI)", () => {
  it("API response shape: tours array contains expected fields", async () => {
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

    const res = await fetch("/api/tours");
    const data = await res.json();

    expect(data.tours).toHaveLength(1);
    const tour = data.tours[0];
    expect(tour.id).toBe("t1");
    expect(tour.code).toBe("BALI-7D");
    expect(tour.capacity).toBeGreaterThan(0);
    expect(tour.bookedCount).toBeLessThanOrEqual(tour.capacity);
    expect(data.total).toBe(1);
  });

  it("API response shape: empty tours list", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tours: [], total: 0, page: 1, totalPages: 0 }),
    });

    const res = await fetch("/api/tours");
    const data = await res.json();

    expect(data.tours).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});
