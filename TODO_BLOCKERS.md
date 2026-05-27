# TODO_BLOCKERS — Phase 12 (Settings UI)

## B1 — UI tests skipped: vitest configured for `node` environment only

**Status:** SKIPPED (tests written but use `describe.skip`)

**Root cause:** `vitest.config.ts` sets `environment: "node"` globally. React
component tests require `environment: "jsdom"` plus `@testing-library/react`
render infrastructure.

**Impact:** The four `page.test.tsx` files (intake-forms, assignment, tours,
spam) are present but all tests are inside `describe.skip(...)`. They do NOT
fail CI — they are just not executed.

**Fix when unblocked:**
1. Create `vitest.ui.config.ts`:
   ```ts
   import { defineConfig } from "vitest/config";
   import path from "node:path";
   import react from "@vitejs/plugin-react";

   export default defineConfig({
     plugins: [react()],
     resolve: { alias: { "@": path.resolve(__dirname, "src") } },
     test: {
       environment: "jsdom",
       setupFiles: ["./src/test/setup.ts"],
     },
   });
   ```
2. Create `src/test/setup.ts`:
   ```ts
   import "@testing-library/jest-dom";
   ```
3. Add to `package.json` scripts:
   ```json
   "test:ui": "vitest run --config vitest.ui.config.ts"
   ```
4. Remove `describe.skip` from the four page test files.
5. Implement render + interaction assertions in full.

**Effort:** ~1 hour

---

## B2 — `/settings/intake-forms/[id]` recent logs endpoint

**Status:** PARTIAL — page implemented with fallback

**Root cause:** `GET /api/intake-forms/:id` response shape was not inspected
for a `recentLogs` field. The detail page issues a second fetch with
`?includeRecentLogs=true` but the backend may not support that query param.

**Impact:** Recent submissions section shows empty state on first load unless
backend is updated.

**Fix:** Check `GET /api/intake-forms/[id]/route.ts` and either add
`includeRecentLogs` support or fetch from a dedicated logs endpoint.

---

## B3 — E2E test stubs not created (Playwright not configured)

**Status:** SKIPPED — Playwright is not installed/configured in this repo.

**Reason:** No `playwright.config.ts` found. Creating stubs would add dead
configuration. Phase 14 handles E2E setup.

**Files deferred:**
- `e2e/intake-form-config.spec.ts`
- `e2e/assignment-named-pools.spec.ts`
- `e2e/mark-as-spam.spec.ts`
- `e2e/tour-sold-out.spec.ts`
