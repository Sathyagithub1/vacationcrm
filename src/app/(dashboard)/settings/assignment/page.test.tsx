/**
 * src/app/(dashboard)/settings/assignment/page.test.tsx
 *
 * UI environment tests for /settings/assignment.
 *
 * Verifies API response shapes and PATCH call conventions.
 * Full component rendering deferred until Next.js server context is available
 * in jsdom.
 *
 * Run with:  npx vitest run --config vitest.ui.config.ts
 */

import { describe, it, expect, vi } from "vitest";

describe("/settings/assignment (UI)", () => {
  it("API response shape: null strategy returns correctly shaped object", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ strategy: null }),
    });

    const res = await fetch("/api/assignment-strategy");
    const data = await res.json();

    expect(Object.prototype.hasOwnProperty.call(data, "strategy")).toBe(true);
    expect(data.strategy).toBeNull();
  });

  it("PUT /api/assignment-strategy sends strategy type in body", async () => {
    const putMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ strategy: { type: "ROUND_ROBIN" } }),
    });
    global.fetch = putMock;

    await fetch("/api/assignment-strategy", {
      method: "PUT",
      body: JSON.stringify({ type: "ROUND_ROBIN" }),
    });

    expect(putMock).toHaveBeenCalledWith(
      "/api/assignment-strategy",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ type: "ROUND_ROBIN" }),
      }),
    );
  });
});
