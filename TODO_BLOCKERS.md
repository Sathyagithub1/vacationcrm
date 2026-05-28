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

---

## B4 — Snippet browser runtime tests skipped (jsdom not installed)

**Status:** SKIPPED — 5 tests in `src/lib/snippet/template.test.ts` are inside
`describe.skip(...)`.

**Root cause:** `vitest.config.ts` sets `environment: "node"` globally and
`jsdom` is not in `node_modules`. The 10 node-environment tests for token
substitution DO run and pass.

**Impact:** The IIFE's runtime behaviour (delegated submit listener,
FormData serialisation, CSS selector computation, X-Captured
preventDefault) is not tested in CI.

**Fix when unblocked:**
1. Install jsdom: `npm install --save-dev jsdom @vitest/browser` (or just
   `vitest` ships `environment: "jsdom"` natively once jsdom is installed).
2. Follow B1 steps (create `vitest.ui.config.ts`, `src/test/setup.ts`).
3. Remove `describe.skip` from the 5 browser tests.
4. Provide a `fetch` mock that returns `{ headers: { get: () => null } }`.

**Effort:** ~30 minutes

---

## B6 — Load tests batched (not truly 100-concurrent) due to Prisma connection pool limit

**Status:** DOCUMENTED — tests pass with batch size 25; true 100-concurrent would exhaust the pool.

**Root cause:** Prisma's default connection pool size is ~10 connections. Running
100 `runPipeline()` calls concurrently causes all DB operations inside each stage
to queue, and the advisory-lock transaction in the round-robin cursor strategy
adds further contention. At 100-concurrent we observed P1017 (connection closed)
and pool timeout errors.

**Workaround applied (Phase 6a):**
- `src/tests/load/intake-burst-dedup.test.ts` — batches of 25
- `src/tests/load/intake-burst-distribution.test.ts` — batches of 25

Concurrency within each batch (25 simultaneous) is still meaningful for exercising
dedup and assignment-cursor race conditions; it just isn't 100-simultaneous.

**Fix when pool size is tunable:**
```
# In DATABASE_URL or via PgBouncer, set pool_max to 50+
# Then remove the runInBatches wrapper and use:
await Promise.allSettled(payloads.map((p) => runPipeline(p, stages)));
```

Alternatively, set `connection_limit` in the Prisma datasource block:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  connection_limit = 50
}
```

**Effort:** ~15 minutes once infra pool is sized correctly.

---

## B7 — Lead-level dedup race window under concurrent intakes

**Status:** DOCUMENTED — load test revealed real production gap.

**Root cause:** `dedupCheck` stage reads Customer rows BEFORE `dispatch` stage
writes them. When two intakes for the same phone arrive concurrently:
1. Both pass `dedupCheck` with no existing Customer found
2. Both proceed to `dispatch`
3. `dispatch` Customer.create — one succeeds, the other catches P2002 and
   re-fetches (this part is safe — Customer table has @@unique([tenantId, mobile]))
4. BOTH `dispatch` calls then proceed to create Lead rows for the same Customer

Result: 1 Customer, 2 Leads (where 1 was expected with REPEAT_INQUIRY activity).

**Load test result (B7 confirms gap):**
- 100 intakes from 50 phones (each phone twice)
- Observed: 50 customers (DB constraint holds), ~98 Leads, ~2 REPEAT_INQUIRY
- Expected: 50 Customers, 50 Leads, 50 REPEAT_INQUIRY

**Production impact:** Real webhook arrival rates (≤1/sec per phone in normal
operation) rarely hit this race. Risk is highest during burst traffic from
single-source campaigns (Meta lead ads burst delivery, form contest submissions).

**Fix options:**
1. **Per-phone advisory lock** in dedup stage — `pg_advisory_xact_lock` on
   hash(tenantId:phone). Serializes intakes for the same phone, eliminates race.
   Effort: ~2 hours. Slight latency increase per intake (~5ms on uncontended).
2. **Compound unique on Lead** — `@@unique([tenantId, customerId, createdDay])`
   would prevent duplicate Leads on same day. But changes business semantics
   (legitimate same-day re-engagements would fail).
3. **Re-check inside dispatch** — after P2002 retry, re-run dedup logic to
   convert the second intake into a REPEAT_INQUIRY. Effort: ~1 hour.

**Recommendation:** Option 1 (advisory lock) — cleanest, matches existing
patterns (round-robin cursor uses advisory locks for same reason).

---

## B8 — LOAD_BALANCED strategy has high variance under concurrent burst

**Status:** DOCUMENTED — load test revealed strategy is unsuitable for burst.

**Root cause:** `LOAD_BALANCED` strategy issues a single SELECT computing the
agent with the minimum open-lead count and uses `MAX(updated_at) ASC` as the
tiebreaker. Under 100 concurrent intakes that all start at the same instant,
every call reads the same snapshot — all agents have 0 open leads — and the
tiebreaker SELECT returns the same agent for many of the concurrent calls
before any write commits.

**Load test result (B8 confirms gap):**
- 100 intakes from 100 unique phones (no dedup contention), 5 agents
- ROUND_ROBIN distribution: typically [16-24] per agent (within ±20%)
- LOAD_BALANCED distribution: one agent observed at 10 leads, another at 35+
  (variance approaching ±75%)

**Production impact:** LOAD_BALANCED works fine for sustained moderate load
where intakes arrive seconds apart and writes commit between reads. It is the
WRONG strategy for burst traffic (campaign launches, Meta ads delivery, etc.).
The admin UI should warn admins of this when LOAD_BALANCED is selected.

**Fix options:**
1. **SELECT FOR UPDATE** on the chosen agent row inside a transaction — serializes
   load-balanced picks. Effort: ~1 hour. Tradeoff: each pick now takes a row
   lock for ~5-10ms.
2. **Advisory lock per (tenant, departmentId, "load-balanced")** in the cursor
   table — serializes within a department. Cleaner. ~1 hour.
3. **Hybrid: LOAD_BALANCED with random tiebreaker** when multiple agents are
   tied — reduces winner-take-all. ~30 minutes. Doesn't fully eliminate
   variance but improves it.

**Recommendation:** Option 2 (advisory lock per dept) — matches the
ROUND_ROBIN cursor pattern; admins won't see a behaviour difference but the
distribution becomes deterministic.

---

## B5 — No src/modules/channels/meta.ts found (T51)

**Status:** DOCUMENTED — no separate `meta.ts` module existed in
`src/modules/channels/`.

**What was found:**
- Meta messaging adapter: `src/modules/channels/adapters/facebook.adapter.ts`
  (handles Messenger, not Lead Ads)
- Meta Lead Ads webhook: `src/app/api/webhooks/meta/leadgen/route.ts` (T33)
  — already had page_id lookup and access_token extraction logic
- No `connectPage()` OAuth callback existed — Facebook Pages are connected
  manually via the channels settings page (credentials POST)

**What was built instead:**
- `src/lib/meta-subscriptions.ts` — `subscribePageToLeadgen` /
  `unsubscribePageFromLeadgen` call `/{page-id}/subscribed_apps` on Graph API
- `POST/DELETE /api/channel-configs/:id/leadgen` — subscription toggle API
- Lead Ads toggle rendered in channels settings page for FACEBOOK cards
- `docs/intake/meta-setup.md` — platform admin setup guide

**If a full OAuth page-connection flow is needed:**
Create `src/app/api/auth/facebook/callback/route.ts` that:
1. Exchanges the OAuth code for a user token
2. Fetches the user's pages via Graph API
3. Creates/updates `ChannelConfig` with `page_id` + `access_token` in config
4. Calls `subscribePageToLeadgen()` automatically on first connect
This work is deferred to Phase 15 (final wiring).
