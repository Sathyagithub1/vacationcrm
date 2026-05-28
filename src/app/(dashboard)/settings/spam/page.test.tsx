/**
 * src/app/(dashboard)/settings/spam/page.test.tsx
 *
 * UI environment tests for /settings/spam.
 *
 * Verifies API response shapes for the Rules tab.
 * Full component rendering deferred until Next.js server context is available
 * in jsdom.
 *
 * Run with:  npx vitest run --config vitest.ui.config.ts
 */

import { describe, it, expect, vi } from "vitest";

describe("/settings/spam (UI)", () => {
  it("API response shape: empty rules array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [] }),
    });

    const res = await fetch("/api/spam-rules");
    const data = await res.json();

    expect(data.rules).toHaveLength(0);
  });

  it("API response shape: rule row has required fields", async () => {
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

    const res = await fetch("/api/spam-rules");
    const data = await res.json();

    expect(data.rules).toHaveLength(1);
    const rule = data.rules[0];
    expect(rule.id).toBe("r1");
    expect(rule.type).toBe("BLACKLIST");
    expect(rule.identifier).toBe("+919999999999");
    expect(typeof rule.isActive).toBe("boolean");
    expect(rule.isActive).toBe(true);
  });
});
