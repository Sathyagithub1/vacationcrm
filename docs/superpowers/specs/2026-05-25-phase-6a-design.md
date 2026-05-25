# Holiday Delight CRM — Phase 6a Design Spec

**Date:** 2026-05-25
**Status:** Approved (pending spec-reviewer + user final read)
**Scope:** Lead Intake & Routing Spine — universal form intake, assignment engine, tour inventory + sold-out routing, spam blocking
**Builds on:** Phases 1-5 (`2026-05-20-holiday-delight-crm-design.md`, `2026-05-22-holiday-delight-crm-phases2-5-design.md`)
**Sibling sub-projects (separate specs):** 6b (multi-channel messaging + memory), 6c (Razorpay), 6d (voice + IVR)

---

## 1. Overview

Phase 6a is the **intake-and-routing backbone** that every other Phase 6 feature plugs into. It standardises how leads enter the system from any source, ensures they are routed to the right department via a configurable assignment strategy, respects tour availability, and rejects spam before it ever touches an agent's inbox.

### Hard Rules (carried from prior phases)

- **Zero dead features.** Every UI control wires to a real backend flow.
- **Tenant isolation.** Every new table carries `tenant_id`; all reads/writes scoped via the existing `tenantPrisma` proxy.
- **Provider-agnostic AI.** All AI calls (field-map, tour match, language detection, spam classify) use the existing `AIProvider` interface — tenant picks provider in settings.
- **No external services beyond the existing stack** (Postgres, Redis, BullMQ, existing AI providers). No new infra dependencies.
- **No silent failures.** Every webhook, mapping, and assignment writes an audit row.

### Cross-cutting decisions (settled in brainstorm)

- Assignment is **department-scoped by default** — every strategy runs within the lead's resolved department.
- **No capacity caps.** No working-hours gating. Strategies run 24/7. Final fallback when no active agent in dept → `COMPANY_ADMIN`.
- **Dedup is strict** — same phone OR email = same Lead; new submissions become Activities on the existing Lead.
- **Spam is hard-blocked** — matched messages dropped, no Lead/Conversation created, audit row only.

---

## 2. Architecture — the intake pipeline

Every inbound message — WhatsApp, Email, Messenger, Telegram, Website snippet, Meta lead form, Google Form, manual entry — flows through one canonical pipeline:

```
[Channel webhook / intake endpoint]
        │
        ▼
[1. Spam Filter]            ── 4 layers; hard-block on match, drop, log to SpamLog
        │
        ▼
[2. Intake Normalizer]      ── Identify IntakeForm, apply fieldMap → canonical payload
        │
        ▼
[3. Dedup]                  ── Match by phone OR email; existing → append Activity, else continue
        │
        ▼
[4. Department Resolver]    ── Explicit field → IntakeForm.departmentId → AI fallback
        │
        ▼
[5. Tour Matcher]           ── Explicit tour_id → AI tour-catalog match (≥0.8); SOLD_OUT → priority=HIGH + sold-out tag + AI waitlist mini-flow
        │
        ▼
[6. Assignment Engine]      ── Run tenant's chosen strategy within dept; skip on-leave; backstop COMPANY_ADMIN
        │
        ▼
[7. Open Conversation + Notify]
```

Each stage lives in its own module under `src/modules/intake/` (`spam/`, `normalize/`, `dedup/`, `department/`, `tour/`, `assignment/`, `dispatch/`). Stages communicate via a single `IntakePayload` type that grows with each step. Each stage is independently unit-testable and replaceable.

### IntakePayload (canonical type)

```typescript
type IntakePayload = {
  tenantId: string;
  source: LeadSource;
  rawPayload: Record<string, unknown>;     // original webhook body
  sender: { phone?: string; email?: string; channelHandle?: string };
  intakeFormId?: string;
  canonicalFields?: { name?: string; phone?: string; email?: string;
                      language?: string; tourCode?: string; notes?: string;
                      // ... + tenant-configurable extras
                    };
  departmentId?: string;
  tourMatch?: { tourId: string; confidence: number; soldOut: boolean };
  dedupResult?: { existingLeadId?: string; existingCustomerId?: string };
  spamCheck?: { passed: boolean; matchedRuleId?: string };
  webhookLogId: string;                    // foreign key to IntakeWebhookLog
};
```

---

## 3. Data model changes

### 3.1 New models

```prisma
model IntakeForm {
  id                    String    @id @default(uuid())
  tenantId              String    @map("tenant_id")
  source                LeadSource
  externalId            String    @map("external_id")    // FB form_id, Google Form id, snippet form selector, builder webhook key
  name                  String                            // tenant-friendly label
  departmentId          String?   @map("department_id")  // explicit dept (overrides AI resolution)
  defaultTagIds         String[]  @map("default_tag_ids")
  fieldMap              Json                              // { "full_name": "name", "mobile_no": "phone", ... }
  fieldMappingConfirmed Boolean   @default(false)
  status                IntakeFormStatus  @default(PENDING_REVIEW)  // PENDING_REVIEW | ACTIVE | PAUSED
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department Department? @relation(fields: [departmentId], references: [id])
  leads      Lead[]

  @@unique([tenantId, source, externalId])
  @@index([tenantId, status])
  @@map("intake_forms")
}

model AssignmentStrategy {
  id        String                @id @default(uuid())
  tenantId  String                @unique @map("tenant_id")   // one per tenant
  type      AssignmentStrategyType
  config    Json                                              // tier cutoffs, language defaults, etc.
  updatedAt DateTime               @updatedAt
  tenant    Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("assignment_strategies")
}

model AssignmentPool {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  name          String                                        // "Web leads pool"
  agentIds      String[] @map("agent_ids")                    // selected User ids
  sourceMatch   Json     @default("[]")                       // [{ source: "META_LEAD_AD" }, { source: "WEBSITE_SNIPPET" }]
  departmentId  String?  @map("department_id")                // optional dept routing
  priority      Int      @default(0)                          // higher wins when multiple match
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department    Department? @relation(fields: [departmentId], references: [id])
  @@index([tenantId, isActive, priority])
  @@map("assignment_pools")
}

model AssignmentCursor {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  scope         String                                        // "dept:<id>" | "pool:<id>" | "tier:<n>"
  lastAgentId   String?  @map("last_agent_id")
  updatedAt     DateTime @updatedAt
  @@unique([tenantId, scope])
  @@map("assignment_cursors")
}

model Tag {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  name      String
  color     String?                                            // hex
  scope     TagScope                                           // CUSTOMER | LEAD | BOTH
  createdAt DateTime @default(now())
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, name, scope])
  @@map("tags")
}

model Tour {
  id           String     @id @default(uuid())
  tenantId     String     @map("tenant_id")
  code         String                                          // tenant-friendly code, e.g. "GOA-HM-15DEC"
  name         String
  description  String?
  departmentId String     @map("department_id")
  startDate    DateTime   @map("start_date")
  endDate      DateTime   @map("end_date")
  capacity     Int
  sold         Int        @default(0)
  status       TourStatus @default(ACTIVE)                    // DRAFT | ACTIVE | SOLD_OUT | CANCELLED | COMPLETED
  tagIds       String[]   @map("tag_ids")
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  tenant       Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department   Department @relation(fields: [departmentId], references: [id])
  bookings     TourBooking[]
  leads        Lead[]
  @@unique([tenantId, code])
  @@index([tenantId, status])
  @@map("tours")
}

model TourBooking {
  id         String   @id @default(uuid())
  tourId     String   @map("tour_id")
  leadId     String?  @map("lead_id")
  customerId String   @map("customer_id")
  seats      Int      @default(1)
  status     TourBookingStatus @default(CONFIRMED)            // CONFIRMED | CANCELLED | WAITLISTED
  bookedAt   DateTime @default(now())
  tour       Tour     @relation(fields: [tourId], references: [id], onDelete: Cascade)
  lead       Lead?    @relation(fields: [leadId], references: [id])
  customer   Customer @relation(fields: [customerId], references: [id])
  @@index([tourId, status])
  @@map("tour_bookings")
}

model SpamRule {
  id            String       @id @default(uuid())
  tenantId      String       @map("tenant_id")
  type          SpamRuleType                                  // BLACKLIST | RATE_LIMIT | PATTERN | AI
  channels      String[]                                      // ["WHATSAPP","EMAIL",...]
  departmentIds String[]     @map("department_ids")           // empty array = all departments
  identifier    String                                        // phone / email / handle / regex / keyword / "ai-classifier"
  reason        String?
  threshold     Int?                                          // for RATE_LIMIT
  windowSeconds Int?         @map("window_seconds")           // for RATE_LIMIT
  blockSeconds  Int?         @map("block_seconds")            // for RATE_LIMIT auto-block duration
  aiThreshold   Float?       @map("ai_threshold")             // for AI rules (default 0.95)
  createdById   String?      @map("created_by_id")
  expiresAt     DateTime?    @map("expires_at")
  isActive      Boolean      @default(true)
  createdAt     DateTime     @default(now())
  tenant        Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdBy     User?        @relation(fields: [createdById], references: [id])
  @@index([tenantId, isActive])
  @@map("spam_rules")
}

model SpamLog {
  id               String   @id @default(uuid())
  tenantId         String   @map("tenant_id")
  channel          String
  senderIdentifier String   @map("sender_identifier")
  rawPayload       Json     @map("raw_payload")
  matchedRuleId    String?  @map("matched_rule_id")
  action           SpamAction                                 // BLOCKED
  occurredAt       DateTime @default(now())
  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, occurredAt])
  @@map("spam_logs")
}

model IntakeWebhookLog {
  id               String   @id @default(uuid())
  tenantId         String?  @map("tenant_id")                 // nullable: signature failures may not resolve tenant
  source           LeadSource?
  endpoint         String
  rawPayload       Json     @map("raw_payload")
  signatureValid   Boolean  @map("signature_valid")
  processed        Boolean  @default(false)
  errorMessage     String?  @map("error_message")
  leadId           String?  @map("lead_id")
  receivedAt       DateTime @default(now())
  @@index([tenantId, receivedAt])
  @@map("intake_webhook_logs")
}
```

### 3.2 New enums

```prisma
enum AssignmentStrategyType {
  ROUND_ROBIN
  LOAD_BALANCED
  SKILL_BASED
  AI_TIERED
  NAMED_POOLS
}

enum IntakeFormStatus { PENDING_REVIEW  ACTIVE  PAUSED }
enum TagScope         { CUSTOMER  LEAD  BOTH }
enum TourStatus       { DRAFT  ACTIVE  SOLD_OUT  CANCELLED  COMPLETED }
enum TourBookingStatus{ CONFIRMED  CANCELLED  WAITLISTED }
enum SpamRuleType     { BLACKLIST  RATE_LIMIT  PATTERN  AI }
enum SpamAction       { BLOCKED }
```

### 3.3 Extended models

```prisma
// User additions
languages         String[] @default([])              // ISO codes: ["en","hi","ta"]
tags              String[] @default([])              // user-defined skill tags
assignmentTier    Int?                               // 1 / 2 / 3 — for AI_TIERED strategy
onLeaveUntil      DateTime?                         // null = available

// Lead additions
language          String?                            // detected language ISO
tourId            String?
intakeFormId      String?
// existing priority field (LeadPriority enum) reused

// LeadSource enum additions (extend, do not break existing rows)
META_LEAD_AD
GOOGLE_FORMS
WEBSITE_SNIPPET
FORM_BUILDER
EMAIL
MESSENGER
TELEGRAM
```

### 3.4 Migrations

Five separate Prisma migrations (one per concern) so any failure rolls back cleanly without losing the rest:

1. `20260525_001_intake_forms_and_webhook_logs`
2. `20260525_002_assignment_strategy_and_pools`
3. `20260525_003_tags`
4. `20260525_004_tours_and_bookings`
5. `20260525_005_spam_rules_and_logs`

Plus an `ALTER TABLE` migration for User/Lead/LeadSource extensions (`20260525_006_user_lead_extensions`). All migrations are additive — no destructive changes to existing rows.

---

## 4. Component-level designs

### 4.1 Form intake

#### Website forms — two-pronged

**JS snippet** at `https://vacaycrm.app/snippet/{tenantToken}.js`:
- Tenant pastes `<script async src="https://vacaycrm.app/snippet/{tenantToken}.js"></script>` once in their site footer.
- On load, attaches a single delegated `submit` listener on `document`.
- For every form submission, serializes all named fields → POSTs to `/api/webhooks/intake/{tenantToken}` with `X-Form-Selector` header carrying a CSS-path identifier for that form.
- First submission of an unseen selector creates an `IntakeForm` in `PENDING_REVIEW` and admin is emailed.

**Form-builder webhook receiver** at `POST /api/webhooks/intake/{tenantToken}`:
- Accepts JSON from Typeform / Tally / JotForm / Gravity Forms / WPForms etc.
- Identifies form via configurable webhook key in `IntakeForm.externalId`.
- Same `PENDING_REVIEW` flow if unknown.

Both routes log to `IntakeWebhookLog`. Signature verification when the source supports it (Tally `tally-signature`, JotForm SHA-256, etc.).

#### Meta Ads lead forms

- Single Meta App registered for the platform; tenants connect their Facebook Page via existing OAuth.
- Subscribe Page to `leadgen` webhook on connect.
- Webhook endpoint `POST /api/webhooks/meta/leadgen` verifies Meta signature (`X-Hub-Signature-256`), resolves the Page → Tenant, fetches lead detail via Graph API (`/{lead_id}?access_token=...`), enqueues into intake pipeline.
- Access token stored encrypted in `ChannelConfig.config` JSON.
- Token-refresh handled by existing `ChannelConfig` worker; expiry alerts surfaced as `Notification` to COMPANY_ADMIN.

#### Google Forms

- Provide a templated Apps Script (`/docs/intake/google-forms-template.gs`) tenant pastes into each Form (Tools → Script editor).
- Script binds an `onFormSubmit` trigger that POSTs the response to `/api/webhooks/google-forms/{tenantToken}` with a per-tenant signing key set as a script property.
- On first submission from a new Google Form, server creates `IntakeForm` in `PENDING_REVIEW` with `externalId = formId`.

#### Field mapping

- On first webhook from a new IntakeForm: capture the raw payload keys → call AI provider with a system prompt that asks "match these source keys to canonical Lead fields and return a JSON map".
- Save proposed `fieldMap` on IntakeForm, set `fieldMappingConfirmed = false`.
- Admin reviews + edits in `/settings/intake-forms/{id}/field-map`, clicks confirm → `status = ACTIVE`, `fieldMappingConfirmed = true`.
- Subsequent submissions silently apply the map. Re-confirmation needed if AI detects new fields in payload (raise notification, do not auto-pause).

#### Deduplication (strict merge)

- Within intake step 3, run `SELECT lead.id FROM leads WHERE tenant_id = ? AND (phone = ? OR email = ?) ORDER BY created_at DESC LIMIT 1`.
- If hit: create `LeadActivity { type: REPEAT_INQUIRY, source, rawPayload }` on the existing Lead and STOP — no new Lead, no new assignment.
- Customer record reused; if multiple Customers match (legacy data), pick the most-recently-active and log a `WARN` audit entry for admin manual merge.
- Unique constraint enforcement: add partial unique index `(tenant_id, phone) WHERE phone IS NOT NULL` and `(tenant_id, email) WHERE email IS NOT NULL` on `customers` to prevent race-created duplicates. Insert uses `ON CONFLICT DO NOTHING` semantics via Prisma upsert.

### 4.2 Assignment engine

Entry point: `assignLead(payload: IntakePayload): Promise<{ assigneeId: string; reason: string }>` in `src/modules/intake/assignment/index.ts`.

1. Load tenant's `AssignmentStrategy`.
2. Compute eligible-agent pool based on strategy:

| Strategy | Eligible-pool computation |
|---|---|
| `ROUND_ROBIN` | `User where tenantId, role=AGENT, departmentId=payload.departmentId, isActive=true, (onLeaveUntil IS NULL OR onLeaveUntil < now())` |
| `LOAD_BALANCED` | Same filter; pick agent with min count of open Leads (status NOT IN CLOSED, WON, LOST) |
| `SKILL_BASED` | Same base filter, then INTERSECT (agent.languages contains payload.canonicalFields.language) OR (agent.tags ∩ payload.canonical tags ≠ ∅). Empty intersection → fallback to base filter. |
| `AI_TIERED` | Read tier cutoffs from `AssignmentStrategy.config`; score lead via existing `LeadScore` flow if not already scored; map score → tier; pool = base filter ∩ `assignmentTier = N`. Empty tier → next lower tier. |
| `NAMED_POOLS` | Iterate `AssignmentPool where isActive=true` ordered by `priority desc`; for each pool, check sourceMatch + departmentId compatibility with payload. First match → pool's `agentIds ∩ base filter`. No pool matches → base filter (department-only). |

3. **Tie-breaking / selection:** `ROUND_ROBIN` uses `AssignmentCursor`; `LOAD_BALANCED` picks lowest count, ties by least-recently-assigned; `SKILL_BASED` round-robins within filtered set; `AI_TIERED` load-balances within tier; `NAMED_POOLS` round-robins within pool.
4. **Fallback ladder:**
   - Strategy returns empty pool → re-run base filter (all active agents in dept).
   - Base filter empty → assign to first active `COMPANY_ADMIN`; create `Notification { type: ASSIGNMENT_FALLBACK, severity: HIGH }` for all COMPANY_ADMINs.
5. **Persist:** `Lead.assigneeId = picked`; write `LeadActivity { type: ASSIGNED, meta: { strategy, reason } }`; advance cursor if used.

**Concurrency:** Round-robin cursor updates wrapped in a Postgres advisory lock per `(tenantId, scope)` so concurrent intakes don't all assign to the same agent.

### 4.3 Tour inventory + sold-out routing

**CRUD UI** at `/settings/tours` — standard list / create / edit / archive. Tour code unique per tenant.

**Sold count** computed by `sold = TourBooking.count where tourId=X and status=CONFIRMED`. Trigger updates `Tour.sold` on every booking write (Prisma middleware). When `sold >= capacity`, automatically flip `status = SOLD_OUT` (admin can manually flip back if a booking is cancelled).

**Tour matcher** in intake step 5:
1. If `payload.canonicalFields.tourCode` present → look up by `(tenantId, code)`. Set `payload.tourMatch = { tourId, confidence: 1, soldOut: status === SOLD_OUT }`.
2. Else, call AI: send the lead's notes + tour catalog (active tours filtered by department if known) → ask for best match with confidence.
3. If AI confidence ≥0.8 → set tourMatch.
4. If <0.8 → `tourMatch = null`, raise UI flag on Lead for agent confirmation.

**Sold-out routing behavior:**
- If `tourMatch.soldOut === true`:
  - Apply pre-tag: `Tag "sold-out"` added to Lead.
  - Set `Lead.priority = HIGH`.
  - Trigger **AI waitlist mini-flow:** send templated message to customer on origin channel: "That tour is fully booked — would you like to (a) join the waitlist, (b) see similar dates, or (c) speak to an agent for alternatives?". Capture response into `LeadActivity`. If (a) → create `TourBooking { status: WAITLISTED }`.
  - Then continue to assignment engine as normal — agent picks up with full waitlist/alt context already visible.
- The AI mini-flow is a single LLM call with three response intents — no multi-turn state needed.

**Future:** Razorpay-driven booking auto-create deferred to Phase 6c. Manual booking creation in v1.

### 4.4 Spam blocking

Intake step 1. Layers run in order; first match short-circuits to BLOCK.

1. **BLACKLIST** — direct identifier match. SQL: `SELECT 1 FROM spam_rules WHERE tenant_id=? AND type='BLACKLIST' AND is_active AND (expires_at IS NULL OR expires_at > now()) AND identifier=? AND (channels @> ARRAY[?] OR channels='{ALL}')`. Indexed on `(tenantId, type, identifier)`.
2. **RATE_LIMIT** — for each active RATE_LIMIT rule with matching channel, count messages from this `senderIdentifier` in the last `windowSeconds` (Redis sorted-set per sender, TTL = window). If count ≥ `threshold`, auto-create a BLACKLIST rule with `expiresAt = now() + blockSeconds`, log block.
3. **PATTERN** — for each active PATTERN rule matching channel, test against the payload's text fields. Regex pre-compiled and cached per tenant in Redis with 5-minute TTL.
4. **AI** — call AI provider with `IsThisSpam(text) -> { isSpam: bool, confidence: float }`. Block if `confidence >= rule.aiThreshold` (default 0.95). Result cached by `sha256(text)` for 1 hour to avoid duplicate cost.

**Hard block action:** write `SpamLog { action: BLOCKED }`, return early from intake. No Lead, no Conversation, no Customer record. The webhook still returns 200 OK so the source doesn't retry.

**"Mark as spam" UI:**
- On any Conversation, button "Mark as spam" → modal with two multi-select dropdowns:
  - **Channels** (pre-populated with this sender's known channels, "All channels" toggle)
  - **Departments** (pre-populated with this lead's department, "All departments" toggle)
- On confirm → creates `SpamRule { type: BLACKLIST, channels, departmentIds, identifier: sender }`. Also bulk-deletes any open/queued messages from this sender for this tenant.
- Reversible by deactivating the rule in `/settings/spam`.

**Department scoping:** A spam rule with `departmentIds = []` blocks across all departments. Non-empty array means the block only applies when the intake resolves to one of those departments. This is useful when the same sender is legit for one dept but spam for another (rare but real).

---

## 5. API surface

All routes under existing Next.js `src/app/api/`, authenticated via existing NextAuth session (admin UIs) or per-tenant webhook signing key (intake endpoints).

```
# Intake (public, signed)
POST   /api/webhooks/intake/{tenantToken}
POST   /api/webhooks/meta/leadgen               (Meta signature)
POST   /api/webhooks/google-forms/{tenantToken} (HMAC signed by Apps Script secret)

# Intake form management (admin)
GET    /api/intake-forms                        (list, paginated)
POST   /api/intake-forms                        (manual create)
GET    /api/intake-forms/{id}
PATCH  /api/intake-forms/{id}                   (rename, change dept, change tags, pause/activate)
DELETE /api/intake-forms/{id}
GET    /api/intake-forms/{id}/field-map
PATCH  /api/intake-forms/{id}/field-map         (admin confirm/edit)
POST   /api/intake-forms/{id}/test              (replay last raw payload through pipeline for debug)

# Assignment
GET    /api/assignment-strategy
PUT    /api/assignment-strategy                 (set type + config)
GET    /api/assignment-pools
POST   /api/assignment-pools
PATCH  /api/assignment-pools/{id}
DELETE /api/assignment-pools/{id}
GET    /api/users/agents?departmentId=&isActive= (used by pool picker UI)

# Tours
GET    /api/tours
POST   /api/tours
GET    /api/tours/{id}
PATCH  /api/tours/{id}
DELETE /api/tours/{id}
POST   /api/tours/{id}/bookings                 (manual booking, future Razorpay webhook also writes here)
PATCH  /api/tours/{id}/bookings/{bookingId}
DELETE /api/tours/{id}/bookings/{bookingId}

# Spam
GET    /api/spam-rules
POST   /api/spam-rules
PATCH  /api/spam-rules/{id}
DELETE /api/spam-rules/{id}
GET    /api/spam-logs?from=&to=&channel=         (paginated audit view)
POST   /api/conversations/{id}/mark-spam        (modal submit; payload: { channels[], departmentIds[] })

# Tags (shared with 6b)
GET    /api/tags?scope=
POST   /api/tags
PATCH  /api/tags/{id}
DELETE /api/tags/{id}
```

All write endpoints call `requireAuth()` / `requirePermission()` per the existing RBAC model. All read endpoints scope to `tenantPrisma`. All endpoints log to existing `AuditLog`.

---

## 6. UI / Settings pages (new)

Under existing `/settings` shell, four new top-level pages:

- `/settings/intake-forms` — list (name, source, status, last-submission), per-form detail with field-map editor, "Test with last payload" button, pause/activate
- `/settings/assignment` — strategy picker (radio buttons, 5 options) + per-strategy config sub-form. For NAMED_POOLS, pool manager with multi-select agent picker (live list from `/api/users/agents` filtered by AGENT role and tenant); for AI_TIERED, cutoffs + tier-count + agent-tier assignment grid.
- `/settings/tours` — table list with capacity bars, status filter; create/edit modal; booking sub-table per tour
- `/settings/spam` — rules table grouped by type, "Add rule" wizard, spam log viewer (date range + channel filter)

UI follows existing Tailwind v4 Sunset Orange theme. No new design tokens. Form widgets reuse existing components in `src/components/forms/`.

`Conversations` view gets a new "Mark as spam" button (RBAC: AGENT and above).

---

## 7. Error handling & edge cases

| Scenario | Behavior |
|---|---|
| Webhook signature invalid | Return 401, log `IntakeWebhookLog.signatureValid = false`, alert admin if same source fails 3× in 1 hour |
| IntakeForm field-map missing | Lead created in `INTAKE_PENDING_REVIEW` status (new Lead status), admin notified; agent sees raw payload until map approved |
| AI field-map call fails | Lead still created in `INTAKE_PENDING_REVIEW`; manual mapping required |
| Dedup race (two near-simultaneous same-phone submissions) | Postgres unique constraint on `(tenantId, phone)` of `customers`; Prisma upsert catches `P2002` → resolve to existing |
| Tour match below 0.8 confidence | Lead created without `tourId`; UI shows "Confirm tour?" banner; agent action persists tourId + writes `LeadActivity` |
| Tour matched but SOLD_OUT and AI mini-flow LLM call fails | Skip mini-flow, still apply sold-out tag + priority HIGH, assign as normal; agent sees "AI mini-flow failed" badge |
| No active agents in department, no COMPANY_ADMIN online | Lead remains in NEW status, every COMPANY_ADMIN emailed + push-notified |
| All assignment cursor advisory locks contend (load test) | Falls back to optimistic concurrency; worst case ~10 concurrent intakes serialize for 50 ms |
| Spam AI provider down | Skip Layer 4 only; Layers 1-3 still run; degraded mode logged in `IntakeWebhookLog.errorMessage` |
| Meta access token expired | Tenant notified; intake from that Page paused; banner in `/settings/channels`; existing token-refresh worker handles renewal |
| Apps Script disabled by Google | Script's try/catch POSTs failure beacon → tenant notified; auto-disable IntakeForm after 5 consecutive failures |
| Rate-limit Redis key TTL accidentally cleared | Worst-case: legitimate burst not blocked for one window; no data loss |
| LeadSource enum addition affecting existing reports | Migration is additive only; existing rows keep WHATSAPP/WEBSITE/FB/IG/MANUAL values; reports adapt naturally |

---

## 8. Testing scope

### Unit
- `src/modules/intake/spam/*.test.ts` — each of 4 layers, edge cases (expired rule, regex syntax error, AI timeout)
- `src/modules/intake/dedup/dedup.test.ts` — phone-only match, email-only match, both match, neither match, race-condition upsert
- `src/modules/intake/department/resolve.test.ts` — explicit field wins, source mapping fallback, AI fallback
- `src/modules/intake/tour/match.test.ts` — explicit code match, AI ≥0.8, AI <0.8, sold-out detection, mini-flow LLM error path
- `src/modules/intake/assignment/strategies/*.test.ts` — one file per strategy, covering: empty pool fallback, on-leave skip, cursor advance, advisory-lock contention (with `pg-mem` test harness)
- `src/modules/intake/normalize/fieldmap.test.ts` — AI map proposal, admin override, partial map application

### Integration
- `tests/integration/intake-pipeline.test.ts` — end-to-end per source: WhatsApp → spam check → dedup → dept → tour → assignment. One test case per source (WA / Email / Messenger / Telegram / Website snippet / Meta lead / Google Form / Manual entry).
- `tests/integration/spam-rate-limit.test.ts` — 11 messages in 60s → block triggers, 12th dropped.

### E2E (Playwright)
- `e2e/intake-form-config.spec.ts` — admin creates new IntakeForm, submits matching test payload, confirms field-map, lead appears in inbox.
- `e2e/assignment-named-pools.spec.ts` — admin configures NAMED_POOLS strategy with 3 agents, submits 6 leads, verifies even round-robin distribution and dept-scoping.
- `e2e/mark-as-spam.spec.ts` — agent marks sender as spam (multi-select channels + departments), next submission blocked, SpamLog entry visible.
- `e2e/tour-sold-out.spec.ts` — admin creates tour with capacity 2, 2 bookings → status flips SOLD_OUT, new enquiry triggers AI mini-flow + HIGH priority + sold-out tag.

### Load
- `tests/load/intake-burst.test.ts` — 100 concurrent webhook intakes (50 unique senders); assert no duplicate Leads, all assignments distributed within ±15% of even.

### Pass criteria
- Unit ≥85% line coverage on new modules
- Zero P0/P1 issues from spec-document-reviewer pass
- All E2E green on CI before merge

---

## 9. Out of scope (deferred to later 6x sub-projects)

- **Cross-channel identity unification** — same person on WA (`+91...`) and Email (`x@y.com`) recognised as one Customer. Phase 6b owns this.
- **Razorpay-driven `TourBooking` auto-create** on successful payment. Phase 6c.
- **Voice / IVR intake source** including spam detection on inbound calls. Phase 6d.
- **Global / cross-tenant blocklist** — sharing spam intelligence across tenants. Future SaaS phase.
- **AI spam classifier feedback UI** beyond admin-tunable `aiThreshold` — auto-retraining loop is post-v1.
- **Snippet auto-injection via WP/Shopify app** — manual snippet paste for v1; CMS plugins later.
- **Multi-currency tour pricing / payment** — out of 6a scope (6c).
- **Smart Customer-merge UI** when dedup `WARN` fires (multiple legacy Customers match same phone) — log only in v1; admin merges manually in DB.

---

## 10. Rollout plan

1. Migrations 1-6 applied in `npx prisma migrate dev` order.
2. Modules built bottom-up: `tags` → `spam` → `dedup` → `normalize` → `department` → `tour` → `assignment` → `dispatch`. Each module mergeable independently behind a feature flag (`INTAKE_PIPELINE_V2_ENABLED`).
3. Existing webhook routes kept live in parallel; new pipeline wired only after E2E green.
4. Flip `INTAKE_PIPELINE_V2_ENABLED=true` per-tenant after smoke test on local dev DB clone.
5. Backfill: existing Leads stay as-is; no historical re-routing.
6. Production deploy via `vps-deploy` skill: backup → push → migrate → smoke test → verify health.

---

## 11. References

- Prior Phase 1 spec: `2026-05-20-holiday-delight-crm-design.md`
- Prior Phases 2-5 spec: `2026-05-22-holiday-delight-crm-phases2-5-design.md`
- Existing models referenced: `Lead`, `Customer`, `Department`, `Tenant`, `User`, `Conversation`, `Message`, `ChannelConfig`, `AIProvider`, `LeadScore`, `LeadActivity`, `Notification`, `AuditLog`, `WebhookLog`
- Phase 6 roadmap memory: `project_holiday_delight_crm.md` (Phase 6 roadmap section)
