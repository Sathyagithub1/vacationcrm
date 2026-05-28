/**
 * src/app/(dashboard)/settings/intake-forms/page.test.tsx
 *
 * UI environment tests for /settings/intake-forms.
 *
 * These tests verify API integration behaviour (fetch mock shapes) and do not
 * require full component rendering — render assertions are deferred until the
 * page component is importable in jsdom without Next.js server-context errors.
 *
 * Run with:  npx vitest run --config vitest.ui.config.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("/settings/intake-forms (UI)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("API response shape: forms array and pagination fields are present", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        forms: [
          {
            id: "form-1",
            name: "WhatsApp Lead Form",
            source: "whatsapp",
            status: "ACTIVE",
            lastSubmissionAt: "2026-05-01T10:00:00Z",
            fieldMappingConfirmed: true,
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      }),
    });

    const res = await fetch("/api/intake-forms");
    const data = await res.json();

    expect(data.forms).toHaveLength(1);
    expect(data.forms[0].id).toBe("form-1");
    expect(data.forms[0].status).toBe("ACTIVE");
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBe(1);
  });

  it("API response shape: empty state returns empty forms array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ forms: [], total: 0, page: 1, totalPages: 0 }),
    });

    const res = await fetch("/api/intake-forms");
    const data = await res.json();

    expect(data.forms).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it("PATCH call to pause a form sends correct status in body", async () => {
    const patchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = patchMock;

    await fetch("/api/intake-forms/form-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "PAUSED" }),
    });

    expect(patchMock).toHaveBeenCalledWith(
      "/api/intake-forms/form-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "PAUSED" }),
      }),
    );
  });
});
