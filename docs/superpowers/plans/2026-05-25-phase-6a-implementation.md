# Phase 6a — Lead Intake & Routing Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the canonical intake-and-routing pipeline every Phase 6 feature plugs into — universal form intake (Website / Meta Ads / Google Forms), 5 selectable assignment strategies (department-scoped), tour inventory with sold-out AI mini-flow + HIGH-priority routing, and a 4-layer hard-block spam filter.

**Architecture:** Single pipeline `Webhook → Spam → Normalize → Dedup → Department → Tour → Assignment → Dispatch`. Each stage is a single-responsibility module under `src/modules/intake/` that operates on the shared `IntakePayload` type and is independently unit-testable. All AI calls go through the existing `AIProvider` interface. Feature-flagged behind `INTAKE_PIPELINE_V2_ENABLED` per tenant for safe rollout.

**Tech Stack:** Next.js 16 / Prisma 7 / PostgreSQL 16 / Redis 7 / BullMQ / Socket.io / Anthropic SDK / OpenAI SDK / Google GenAI SDK / Playwright (E2E)

**Spec:** `docs/superpowers/specs/2026-05-25-phase-6a-design.md`

**Build Order (mergeable per task, flag-gated end-to-end):**
1. Schema (T1–T6)
2. Pipeline scaffold + types (T7–T8)
3. Spam module (T9–T13)
4. Normalize module (T14–T16)
5. Dedup module (T17–T18)
6. Department resolver (T19)
7. Tour module (T20–T22)
8. Assignment module (T23–T30)
9. Dispatch module (T31)
10. Intake webhook routes (T32–T34)
11. Admin API routes (T35–T42)
12. Settings UI (T43–T48)
13. Snippet + Apps Script + Meta hookup (T49–T51)
14. E2E + load tests (T52–T55)
15. Pipeline wiring + flag rollout (T56–T57)

**Pre-flight (do once at start):**
- Pull latest `master`; ensure `pnpm install` (or `npm install`) is clean
- Confirm local Postgres + Redis are running (`docker compose up -d postgres redis`)
- Confirm `npx prisma migrate dev --create-only` works against the current schema
- Open the spec side-by-side; every task references a spec section

---

## Phase 1: Schema & migrations

### Task 1: Migration 001 — IntakeForm + IntakeWebhookLog

**Spec ref:** §3.1, §3.2, §3.4

**Files:**
- Modify: `prisma/schema.prisma`
- Create (Prisma will generate): `prisma/migrations/20260525000001_intake_forms_and_webhook_logs/migration.sql`

- [ ] **Step 1: Add enums to schema**

In `prisma/schema.prisma`, after the existing enums block, append:

```prisma
enum IntakeFormStatus {
  PENDING_REVIEW
  ACTIVE
  PAUSED
}
```

Also extend the existing `LeadSource` enum — add these values WITHOUT removing the existing ones:

```prisma
enum LeadSource {
  WHATSAPP
  WEBSITE
  FB
  IG
  MANUAL
  META_LEAD_AD
  GOOGLE_FORMS
  WEBSITE_SNIPPET
  FORM_BUILDER
  EMAIL
  MESSENGER
  TELEGRAM
}
```

- [ ] **Step 2: Add `IntakeForm` model**

```prisma
model IntakeForm {
  id                    String           @id @default(uuid())
  tenantId              String           @map("tenant_id")
  source                LeadSource
  externalId            String           @map("external_id")
  name                  String
  departmentId          String?          @map("department_id")
  defaultTagIds         String[]         @default([]) @map("default_tag_ids")
  fieldMap              Json
  fieldMappingConfirmed Boolean          @default(false) @map("field_mapping_confirmed")
  status                IntakeFormStatus @default(PENDING_REVIEW)
  createdAt             DateTime         @default(now()) @map("created_at")
  updatedAt             DateTime         @updatedAt @map("updated_at")

  tenant     Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department Department? @relation(fields: [departmentId], references: [id])
  leads      Lead[]

  @@unique([tenantId, source, externalId])
  @@index([tenantId, status])
  @@map("intake_forms")
}
```

- [ ] **Step 3: Add `IntakeWebhookLog` model**

```prisma
model IntakeWebhookLog {
  id             String      @id @default(uuid())
  tenantId       String?     @map("tenant_id")
  source         LeadSource?
  endpoint       String
  rawPayload     Json        @map("raw_payload")
  signatureValid Boolean     @map("signature_valid")
  processed      Boolean     @default(false)
  errorMessage   String?     @map("error_message")
  leadId         String?     @map("lead_id")
  receivedAt     DateTime    @default(now()) @map("received_at")

  @@index([tenantId, receivedAt])
  @@map("intake_webhook_logs")
}
```

- [ ] **Step 4: Add inverse relations on `Tenant`, `Department`**

In `Tenant`: add `intakeForms IntakeForm[]`
In `Department`: add `intakeForms IntakeForm[]`

- [ ] **Step 5: Generate + run migration**

```bash
npx prisma migrate dev --name intake_forms_and_webhook_logs
```

Expected: migration created at `prisma/migrations/<timestamp>_intake_forms_and_webhook_logs/`, applied to dev DB, Prisma Client regenerated.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(6a): schema — intake_forms + intake_webhook_logs"
```

---

### Task 2: Migration 002 — AssignmentStrategy + AssignmentPool + AssignmentCursor

**Spec ref:** §3.1, §3.2

**Files:** `prisma/schema.prisma`

- [ ] **Step 1: Add enum**

```prisma
enum AssignmentStrategyType {
  ROUND_ROBIN
  LOAD_BALANCED
  SKILL_BASED
  AI_TIERED
  NAMED_POOLS
}
```

- [ ] **Step 2: Add three models**

```prisma
model AssignmentStrategy {
  id        String                 @id @default(uuid())
  tenantId  String                 @unique @map("tenant_id")
  type      AssignmentStrategyType
  config    Json                   @default("{}")
  updatedAt DateTime               @updatedAt @map("updated_at")
  tenant    Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("assignment_strategies")
}

model AssignmentPool {
  id           String      @id @default(uuid())
  tenantId     String      @map("tenant_id")
  name         String
  agentIds     String[]    @map("agent_ids")
  sourceMatch  Json        @default("[]") @map("source_match")
  departmentId String?     @map("department_id")
  priority     Int         @default(0)
  isActive     Boolean     @default(true) @map("is_active")
  createdAt    DateTime    @default(now()) @map("created_at")
  tenant       Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department   Department? @relation(fields: [departmentId], references: [id])
  @@index([tenantId, isActive, priority])
  @@map("assignment_pools")
}

model AssignmentCursor {
  id          String   @id @default(uuid())
  tenantId    String   @map("tenant_id")
  scope       String
  lastAgentId String?  @map("last_agent_id")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@unique([tenantId, scope])
  @@map("assignment_cursors")
}
```

- [ ] **Step 3: Add inverse relations**

`Tenant` gets: `assignmentStrategy AssignmentStrategy?`, `assignmentPools AssignmentPool[]`
`Department` gets: `assignmentPools AssignmentPool[]`

- [ ] **Step 4: Migrate + commit**

```bash
npx prisma migrate dev --name assignment_strategy_and_pools
git add prisma && git commit -m "feat(6a): schema — assignment_strategies, pools, cursors"
```

---

### Task 3: Migration 003 — Tag

**Spec ref:** §3.1, §3.2

- [ ] **Step 1: Add enum**

```prisma
enum TagScope {
  CUSTOMER
  LEAD
  BOTH
}
```

- [ ] **Step 2: Add model**

```prisma
model Tag {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  name      String
  color     String?
  scope     TagScope
  createdAt DateTime @default(now()) @map("created_at")
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, name, scope])
  @@map("tags")
}
```

- [ ] **Step 3: Add inverse relation on `Tenant`: `tags Tag[]`**

- [ ] **Step 4: Migrate + commit**

```bash
npx prisma migrate dev --name tags
git add prisma && git commit -m "feat(6a): schema — tags"
```

---

### Task 4: Migration 004 — Tour + TourBooking

**Spec ref:** §3.1, §3.2

- [ ] **Step 1: Add enums**

```prisma
enum TourStatus {
  DRAFT
  ACTIVE
  SOLD_OUT
  CANCELLED
  COMPLETED
}

enum TourBookingStatus {
  CONFIRMED
  CANCELLED
  WAITLISTED
}
```

- [ ] **Step 2: Add models**

```prisma
model Tour {
  id           String     @id @default(uuid())
  tenantId     String     @map("tenant_id")
  code         String
  name         String
  description  String?
  departmentId String     @map("department_id")
  startDate    DateTime   @map("start_date")
  endDate      DateTime   @map("end_date")
  capacity     Int
  sold         Int        @default(0)
  status       TourStatus @default(ACTIVE)
  tagIds       String[]   @default([]) @map("tag_ids")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")

  tenant     Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  department Department    @relation(fields: [departmentId], references: [id])
  bookings   TourBooking[]
  leads      Lead[]

  @@unique([tenantId, code])
  @@index([tenantId, status])
  @@map("tours")
}

model TourBooking {
  id         String            @id @default(uuid())
  tourId     String            @map("tour_id")
  leadId     String?           @map("lead_id")
  customerId String            @map("customer_id")
  seats      Int               @default(1)
  status     TourBookingStatus @default(CONFIRMED)
  bookedAt   DateTime          @default(now()) @map("booked_at")

  tour     Tour     @relation(fields: [tourId], references: [id], onDelete: Cascade)
  lead     Lead?    @relation(fields: [leadId], references: [id])
  customer Customer @relation(fields: [customerId], references: [id])

  @@index([tourId, status])
  @@map("tour_bookings")
}
```

- [ ] **Step 3: Add inverse relations**

`Tenant`: `tours Tour[]`
`Department`: `tours Tour[]`
`Customer`: `tourBookings TourBooking[]`

- [ ] **Step 4: Migrate + commit**

```bash
npx prisma migrate dev --name tours_and_bookings
git add prisma && git commit -m "feat(6a): schema — tours + tour_bookings"
```

---

### Task 5: Migration 005 — SpamRule + SpamLog

**Spec ref:** §3.1, §3.2

- [ ] **Step 1: Add enums**

```prisma
enum SpamRuleType {
  BLACKLIST
  RATE_LIMIT
  PATTERN
  AI
}

enum SpamAction {
  BLOCKED
}
```

- [ ] **Step 2: Add models**

```prisma
model SpamRule {
  id            String       @id @default(uuid())
  tenantId      String       @map("tenant_id")
  type          SpamRuleType
  channels      String[]     @default([])
  departmentIds String[]     @default([]) @map("department_ids")
  identifier    String
  reason        String?
  threshold     Int?
  windowSeconds Int?         @map("window_seconds")
  blockSeconds  Int?         @map("block_seconds")
  aiThreshold   Float?       @map("ai_threshold")
  createdById   String?      @map("created_by_id")
  expiresAt     DateTime?    @map("expires_at")
  isActive      Boolean      @default(true) @map("is_active")
  createdAt     DateTime     @default(now()) @map("created_at")

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdBy User?  @relation(fields: [createdById], references: [id])

  @@index([tenantId, isActive])
  @@index([tenantId, type, identifier])
  @@map("spam_rules")
}

model SpamLog {
  id               String     @id @default(uuid())
  tenantId         String     @map("tenant_id")
  channel          String
  senderIdentifier String     @map("sender_identifier")
  rawPayload       Json       @map("raw_payload")
  matchedRuleId    String?    @map("matched_rule_id")
  action           SpamAction
  occurredAt       DateTime   @default(now()) @map("occurred_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, occurredAt])
  @@map("spam_logs")
}
```

- [ ] **Step 3: Add inverse relations on Tenant + User**

`Tenant`: `spamRules SpamRule[]`, `spamLogs SpamLog[]`
`User`: `spamRulesCreated SpamRule[]`

- [ ] **Step 4: Migrate + commit**

```bash
npx prisma migrate dev --name spam_rules_and_logs
git add prisma && git commit -m "feat(6a): schema — spam_rules + spam_logs"
```

---

### Task 6: Migration 006 — User/Lead extensions + Customer dedup constraint

**Spec ref:** §3.3, §4.1 (dedup section)

- [ ] **Step 1: Extend `User` model**

Add to `User`:

```prisma
languages      String[]  @default([])
tags           String[]  @default([])
assignmentTier Int?      @map("assignment_tier")
onLeaveUntil   DateTime? @map("on_leave_until")
```

- [ ] **Step 2: Extend `Lead` model**

Add to `Lead`:

```prisma
language       String?
tourId         String?  @map("tour_id")
intakeFormId   String?  @map("intake_form_id")

tour       Tour?       @relation(fields: [tourId], references: [id])
intakeForm IntakeForm? @relation(fields: [intakeFormId], references: [id])
```

Add a new value to the existing `LeadStatus` enum (one new value `INTAKE_PENDING_REVIEW`):

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  NEGOTIATING
  WON
  LOST
  CLOSED
  INTAKE_PENDING_REVIEW
}
```

(Adjust existing enum values to match the file's current set — only **add** `INTAKE_PENDING_REVIEW`.)

- [ ] **Step 3: Add partial unique indexes for dedup race protection**

Edit the generated migration SQL file. Append at the bottom of the SQL:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_unique
  ON customers (tenant_id, phone) WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_unique
  ON customers (tenant_id, email) WHERE email IS NOT NULL;
```

- [ ] **Step 4: Migrate + verify**

```bash
npx prisma migrate dev --name user_lead_extensions
psql $DATABASE_URL -c "\d+ customers" | grep -E "customers_tenant_(phone|email)_unique"
```

Expected: both partial unique indexes listed.

- [ ] **Step 5: Commit**

```bash
git add prisma && git commit -m "feat(6a): schema — user/lead extensions + customer dedup unique indexes"
```

---

## Phase 2: Pipeline scaffold

### Task 7: Core `IntakePayload` type + pipeline orchestrator skeleton

**Spec ref:** §2

**Files:**
- Create: `src/modules/intake/types.ts`
- Create: `src/modules/intake/pipeline.ts`
- Create: `src/modules/intake/pipeline.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/intake/pipeline.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from './pipeline';
import type { IntakePayload } from './types';

describe('runPipeline', () => {
  it('runs all stages in order and short-circuits on spam block', async () => {
    const payload: IntakePayload = {
      tenantId: 't1', source: 'WEBSITE_SNIPPET',
      rawPayload: {}, sender: { phone: '+919999999999' }, webhookLogId: 'w1',
    };
    const spam = vi.fn().mockResolvedValue({ ...payload, spamCheck: { passed: false, matchedRuleId: 'r1' } });
    const normalize = vi.fn();
    const result = await runPipeline(payload, { spam, normalize } as any);
    expect(spam).toHaveBeenCalledOnce();
    expect(normalize).not.toHaveBeenCalled();
    expect(result.spamCheck?.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect failure (module not found)**

```bash
npx vitest run src/modules/intake/pipeline.test.ts
```

- [ ] **Step 3: Implement `types.ts`**

```typescript
// src/modules/intake/types.ts
import type { LeadSource } from '@prisma/client';

export interface IntakePayload {
  tenantId: string;
  source: LeadSource;
  rawPayload: Record<string, unknown>;
  sender: { phone?: string; email?: string; channelHandle?: string };
  intakeFormId?: string;
  canonicalFields?: {
    name?: string; phone?: string; email?: string;
    language?: string; tourCode?: string; notes?: string;
    tags?: string[];
    [k: string]: unknown;
  };
  departmentId?: string;
  tourMatch?: { tourId: string; confidence: number; soldOut: boolean };
  dedupResult?: { existingLeadId?: string; existingCustomerId?: string };
  spamCheck?: { passed: boolean; matchedRuleId?: string };
  webhookLogId: string;
  leadId?: string;
}

export type IntakeStage = (p: IntakePayload) => Promise<IntakePayload>;

export interface IntakeStages {
  spam: IntakeStage;
  normalize: IntakeStage;
  dedup: IntakeStage;
  department: IntakeStage;
  tour: IntakeStage;
  assignment: IntakeStage;
  dispatch: IntakeStage;
}
```

- [ ] **Step 4: Implement `pipeline.ts`**

```typescript
// src/modules/intake/pipeline.ts
import type { IntakePayload, IntakeStages } from './types';

export async function runPipeline(payload: IntakePayload, stages: IntakeStages): Promise<IntakePayload> {
  let p = await stages.spam(payload);
  if (p.spamCheck && !p.spamCheck.passed) return p;
  p = await stages.normalize(p);
  if (p.dedupResult?.existingLeadId) {
    // dedup happens BEFORE department, but if existing lead found we stop after appending activity
    p = await stages.dedup(p);
    return p;
  }
  p = await stages.dedup(p);
  if (p.dedupResult?.existingLeadId) return p;
  p = await stages.department(p);
  p = await stages.tour(p);
  p = await stages.assignment(p);
  p = await stages.dispatch(p);
  return p;
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run src/modules/intake/pipeline.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/intake/types.ts src/modules/intake/pipeline.ts src/modules/intake/pipeline.test.ts
git commit -m "feat(6a): intake pipeline scaffold + IntakePayload type"
```

---

### Task 8: Feature flag `INTAKE_PIPELINE_V2_ENABLED`

**Spec ref:** §10

**Files:**
- Modify: `.env.example`
- Create: `src/lib/feature-flags.ts`
- Create: `src/lib/feature-flags.test.ts`

- [ ] **Step 1: Add to `.env.example`**

Append:
```
# Phase 6a — gate the new intake pipeline per tenant (comma-separated tenant IDs, or '*' for all)
INTAKE_PIPELINE_V2_ENABLED=
```

- [ ] **Step 2: Test + implementation**

```typescript
// src/lib/feature-flags.test.ts
import { isIntakePipelineV2Enabled } from './feature-flags';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isIntakePipelineV2Enabled', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  it('returns false when unset', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', '');
    expect(isIntakePipelineV2Enabled('t1')).toBe(false);
  });
  it('returns true for any tenant when "*"', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', '*');
    expect(isIntakePipelineV2Enabled('t1')).toBe(true);
  });
  it('returns true for listed tenants only', () => {
    vi.stubEnv('INTAKE_PIPELINE_V2_ENABLED', 't1,t2');
    expect(isIntakePipelineV2Enabled('t1')).toBe(true);
    expect(isIntakePipelineV2Enabled('t3')).toBe(false);
  });
});
```

```typescript
// src/lib/feature-flags.ts
export function isIntakePipelineV2Enabled(tenantId: string): boolean {
  const v = process.env.INTAKE_PIPELINE_V2_ENABLED ?? '';
  if (!v) return false;
  if (v.trim() === '*') return true;
  return v.split(',').map(s => s.trim()).includes(tenantId);
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/lib/feature-flags.test.ts
git add .env.example src/lib/feature-flags.ts src/lib/feature-flags.test.ts
git commit -m "feat(6a): feature flag INTAKE_PIPELINE_V2_ENABLED"
```

---

## Phase 3: Spam module

### Task 9: Blacklist layer

**Spec ref:** §4.4 (Layer 1)

**Files:**
- Create: `src/modules/intake/spam/blacklist.ts`
- Create: `src/modules/intake/spam/blacklist.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/intake/spam/blacklist.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkBlacklist } from './blacklist';
import { prisma } from '@/lib/prisma';

describe('checkBlacklist', () => {
  beforeEach(async () => { /* seed test tenant + dept */ });

  it('matches on exact identifier for ALL channels (empty array)', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 'tenant-test', type: 'BLACKLIST', identifier: '+919999999999',
      channels: [], departmentIds: [],
    }});
    const r = await checkBlacklist({ tenantId: 'tenant-test', channel: 'WHATSAPP', sender: '+919999999999' });
    expect(r.blocked).toBe(true);
  });

  it('does NOT match when channels restrict to other channel', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 'tenant-test', type: 'BLACKLIST', identifier: 'spammer@x.com',
      channels: ['WHATSAPP'], departmentIds: [],
    }});
    const r = await checkBlacklist({ tenantId: 'tenant-test', channel: 'EMAIL', sender: 'spammer@x.com' });
    expect(r.blocked).toBe(false);
  });

  it('does NOT match when expired', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 'tenant-test', type: 'BLACKLIST', identifier: '+918888888888',
      channels: [], departmentIds: [], expiresAt: new Date(Date.now() - 1000),
    }});
    const r = await checkBlacklist({ tenantId: 'tenant-test', channel: 'WHATSAPP', sender: '+918888888888' });
    expect(r.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — fail**

```bash
npx vitest run src/modules/intake/spam/blacklist.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/modules/intake/spam/blacklist.ts
import { prisma } from '@/lib/prisma';

export interface BlacklistInput {
  tenantId: string; channel: string; sender: string; departmentId?: string;
}
export interface BlacklistResult { blocked: boolean; ruleId?: string }

export async function checkBlacklist(input: BlacklistInput): Promise<BlacklistResult> {
  const rule = await prisma.spamRule.findFirst({
    where: {
      tenantId: input.tenantId,
      type: 'BLACKLIST',
      identifier: input.sender,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!rule) return { blocked: false };

  const channelOk = rule.channels.length === 0 || rule.channels.includes(input.channel);
  if (!channelOk) return { blocked: false };

  const deptOk = rule.departmentIds.length === 0 ||
    (input.departmentId ? rule.departmentIds.includes(input.departmentId) : true);
  if (!deptOk) return { blocked: false };

  return { blocked: true, ruleId: rule.id };
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/modules/intake/spam/blacklist.test.ts
git add src/modules/intake/spam/blacklist.ts src/modules/intake/spam/blacklist.test.ts
git commit -m "feat(6a/spam): blacklist layer"
```

---

### Task 10: Rate-limit layer

**Spec ref:** §4.4 (Layer 2)

**Files:**
- Create: `src/modules/intake/spam/rate-limit.ts`
- Create: `src/modules/intake/spam/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/intake/spam/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from './rate-limit';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

describe('checkRateLimit', () => {
  beforeEach(async () => { await redis.flushdb(); });

  it('does not block under threshold', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 't1', type: 'RATE_LIMIT', identifier: 'ALL',
      channels: ['WHATSAPP'], threshold: 10, windowSeconds: 60, blockSeconds: 604800,
    }});
    for (let i = 0; i < 9; i++) {
      const r = await checkRateLimit({ tenantId: 't1', channel: 'WHATSAPP', sender: '+91123' });
      expect(r.blocked).toBe(false);
    }
  });

  it('blocks on Nth message and creates auto-blacklist rule', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 't1', type: 'RATE_LIMIT', identifier: 'ALL',
      channels: ['WHATSAPP'], threshold: 3, windowSeconds: 60, blockSeconds: 60,
    }});
    let last;
    for (let i = 0; i < 3; i++) {
      last = await checkRateLimit({ tenantId: 't1', channel: 'WHATSAPP', sender: '+91123' });
    }
    expect(last!.blocked).toBe(true);
    const autoRule = await prisma.spamRule.findFirst({
      where: { tenantId: 't1', type: 'BLACKLIST', identifier: '+91123' },
    });
    expect(autoRule).not.toBeNull();
    expect(autoRule!.expiresAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test — fail**

- [ ] **Step 3: Implement**

```typescript
// src/modules/intake/spam/rate-limit.ts
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export interface RateLimitInput { tenantId: string; channel: string; sender: string }
export interface RateLimitResult { blocked: boolean; ruleId?: string }

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const rules = await prisma.spamRule.findMany({
    where: { tenantId: input.tenantId, type: 'RATE_LIMIT', isActive: true,
             OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  const matching = rules.filter(r => r.channels.length === 0 || r.channels.includes(input.channel));

  for (const rule of matching) {
    const key = `rl:${input.tenantId}:${rule.id}:${input.sender}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, rule.windowSeconds ?? 60);
    if (count >= (rule.threshold ?? 10)) {
      const expiresAt = new Date(Date.now() + (rule.blockSeconds ?? 604800) * 1000);
      const autoRule = await prisma.spamRule.create({ data: {
        tenantId: input.tenantId, type: 'BLACKLIST', identifier: input.sender,
        channels: rule.channels, departmentIds: rule.departmentIds,
        reason: `Auto-block: ${rule.threshold} msgs in ${rule.windowSeconds}s`,
        expiresAt, isActive: true,
      }});
      return { blocked: true, ruleId: autoRule.id };
    }
  }
  return { blocked: false };
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/modules/intake/spam/rate-limit.test.ts
git add src/modules/intake/spam/rate-limit.ts src/modules/intake/spam/rate-limit.test.ts
git commit -m "feat(6a/spam): rate-limit layer with auto-blacklist"
```

---

### Task 11: Pattern layer

**Spec ref:** §4.4 (Layer 3)

**Files:**
- Create: `src/modules/intake/spam/pattern.ts`
- Create: `src/modules/intake/spam/pattern.test.ts`

- [ ] **Step 1: Test**

```typescript
// src/modules/intake/spam/pattern.test.ts
import { describe, it, expect } from 'vitest';
import { checkPattern } from './pattern';
import { prisma } from '@/lib/prisma';

describe('checkPattern', () => {
  it('matches regex pattern in text', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 't1', type: 'PATTERN', identifier: '\\b(crypto|nft|airdrop)\\b',
      channels: [], departmentIds: [],
    }});
    const r = await checkPattern({ tenantId: 't1', channel: 'WHATSAPP', text: 'free crypto airdrop' });
    expect(r.blocked).toBe(true);
  });
  it('does not match when text safe', async () => {
    const r = await checkPattern({ tenantId: 't1', channel: 'WHATSAPP', text: 'hello sir' });
    expect(r.blocked).toBe(false);
  });
  it('ignores invalid regex (logs warn)', async () => {
    await prisma.spamRule.create({ data: {
      tenantId: 't2', type: 'PATTERN', identifier: '[invalid(',
      channels: [], departmentIds: [],
    }});
    const r = await checkPattern({ tenantId: 't2', channel: 'WHATSAPP', text: 'anything' });
    expect(r.blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Implement with 5-min Redis cache**

```typescript
// src/modules/intake/spam/pattern.ts
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

const CACHE_TTL = 300;

export interface PatternInput { tenantId: string; channel: string; text: string }
export interface PatternResult { blocked: boolean; ruleId?: string }

async function getRules(tenantId: string): Promise<Array<{ id: string; identifier: string; channels: string[]; departmentIds: string[] }>> {
  const cacheKey = `spam:patterns:${tenantId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const rules = await prisma.spamRule.findMany({
    where: { tenantId, type: 'PATTERN', isActive: true,
             OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true, identifier: true, channels: true, departmentIds: true },
  });
  await redis.set(cacheKey, JSON.stringify(rules), 'EX', CACHE_TTL);
  return rules;
}

export async function checkPattern(input: PatternInput): Promise<PatternResult> {
  const rules = await getRules(input.tenantId);
  for (const r of rules) {
    if (r.channels.length > 0 && !r.channels.includes(input.channel)) continue;
    try {
      const re = new RegExp(r.identifier, 'i');
      if (re.test(input.text)) return { blocked: true, ruleId: r.id };
    } catch (e) {
      console.warn(`[spam/pattern] invalid regex on rule ${r.id}: ${r.identifier}`);
    }
  }
  return { blocked: false };
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/spam/pattern.test.ts
git add src/modules/intake/spam/pattern.ts src/modules/intake/spam/pattern.test.ts
git commit -m "feat(6a/spam): pattern layer with Redis-cached rules"
```

---

### Task 12: AI classifier layer

**Spec ref:** §4.4 (Layer 4)

**Files:**
- Create: `src/modules/intake/spam/ai-classifier.ts`
- Create: `src/modules/intake/spam/ai-classifier.test.ts`

- [ ] **Step 1: Test**

```typescript
// src/modules/intake/spam/ai-classifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { checkAi } from './ai-classifier';

vi.mock('@/modules/ai/provider', () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    classify: vi.fn().mockImplementation(async (text: string) => {
      if (text.toLowerCase().includes('viagra')) return { isSpam: true, confidence: 0.98 };
      return { isSpam: false, confidence: 0.1 };
    }),
  }),
}));

describe('checkAi', () => {
  it('blocks when confidence >= threshold', async () => {
    const r = await checkAi({ tenantId: 't1', text: 'buy viagra cheap', threshold: 0.95 });
    expect(r.blocked).toBe(true);
  });
  it('does not block when confidence < threshold', async () => {
    const r = await checkAi({ tenantId: 't1', text: 'hello sir', threshold: 0.95 });
    expect(r.blocked).toBe(false);
  });
  it('returns false safely when AI fails', async () => {
    const r = await checkAi({ tenantId: 't1', text: 'crash', threshold: 0.95, _forceFail: true });
    expect(r.blocked).toBe(false);
    expect(r.degraded).toBe(true);
  });
});
```

- [ ] **Step 2: Implement with 1-hr Redis cache by `sha256(text)`**

```typescript
// src/modules/intake/spam/ai-classifier.ts
import crypto from 'crypto';
import { redis } from '@/lib/redis';
import { getAIProvider } from '@/modules/ai/provider';

const CACHE_TTL = 3600;

export interface AiInput { tenantId: string; text: string; threshold: number; _forceFail?: boolean }
export interface AiResult { blocked: boolean; degraded?: boolean; ruleId?: string }

export async function checkAi(input: AiInput): Promise<AiResult> {
  if (!input.text?.trim()) return { blocked: false };
  const key = `spam:ai:${crypto.createHash('sha256').update(input.text).digest('hex')}`;
  const cached = await redis.get(key);
  if (cached) {
    const { isSpam, confidence } = JSON.parse(cached);
    return { blocked: isSpam && confidence >= input.threshold };
  }
  try {
    if (input._forceFail) throw new Error('forced');
    const provider = await getAIProvider(input.tenantId);
    const res = await provider.classify(input.text);
    await redis.set(key, JSON.stringify(res), 'EX', CACHE_TTL);
    return { blocked: res.isSpam && res.confidence >= input.threshold };
  } catch (e) {
    console.warn(`[spam/ai] classifier failure, degraded mode: ${(e as Error).message}`);
    return { blocked: false, degraded: true };
  }
}
```

> **Note:** `getAIProvider().classify(text)` does not yet exist on the existing AI provider interface. Add a new method `classify(text: string): Promise<{ isSpam: boolean; confidence: number }>` to `src/modules/ai/provider.ts` interface and implement on Claude/OpenAI/Gemini adapters with the prompt: *"Classify whether the following customer message is spam. Return JSON: { isSpam: boolean, confidence: 0-1 }."*

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/spam/ai-classifier.test.ts
git add src/modules/intake/spam/ai-classifier.ts src/modules/intake/spam/ai-classifier.test.ts src/modules/ai/provider.ts
git commit -m "feat(6a/spam): AI classifier layer + provider.classify() interface"
```

---

### Task 13: Spam orchestrator

**Spec ref:** §4.4 (layer ordering)

**Files:**
- Create: `src/modules/intake/spam/index.ts`
- Create: `src/modules/intake/spam/index.test.ts`

- [ ] **Step 1: Test (integration of all 4 layers)**

```typescript
// src/modules/intake/spam/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import { checkSpam } from './index';

describe('checkSpam orchestrator', () => {
  it('short-circuits on first layer match', async () => {
    // arrange blacklist match
    const payload: any = { tenantId: 't1', source: 'WHATSAPP', sender: { phone: '+91123' }, rawPayload: {} };
    const r = await checkSpam(payload);
    expect(r.spamCheck?.passed).toBe(false);
  });
  it('passes when no layer matches', async () => {
    const payload: any = { tenantId: 't2', source: 'WHATSAPP', sender: { phone: '+91999' }, rawPayload: { text: 'hi' } };
    const r = await checkSpam(payload);
    expect(r.spamCheck?.passed).toBe(true);
  });
  it('writes SpamLog on block', async () => { /* ... */ });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/spam/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';
import { checkBlacklist } from './blacklist';
import { checkRateLimit } from './rate-limit';
import { checkPattern } from './pattern';
import { checkAi } from './ai-classifier';

const DEFAULT_AI_THRESHOLD = 0.95;

function senderId(p: IntakePayload): string {
  return p.sender.phone ?? p.sender.email ?? p.sender.channelHandle ?? 'unknown';
}

function rawText(p: IntakePayload): string {
  const r = p.rawPayload as Record<string, unknown>;
  return [r.text, r.message, r.body, r.notes].filter(Boolean).join(' ');
}

export async function checkSpam(payload: IntakePayload): Promise<IntakePayload> {
  const sender = senderId(payload);
  const channel = payload.source;
  const text = rawText(payload);

  const layers = [
    () => checkBlacklist({ tenantId: payload.tenantId, channel, sender }),
    () => checkRateLimit({ tenantId: payload.tenantId, channel, sender }),
    () => checkPattern({ tenantId: payload.tenantId, channel, text }),
    () => checkAi({ tenantId: payload.tenantId, text, threshold: DEFAULT_AI_THRESHOLD }),
  ];

  for (const layer of layers) {
    const r = await layer();
    if (r.blocked) {
      await prisma.spamLog.create({ data: {
        tenantId: payload.tenantId, channel, senderIdentifier: sender,
        rawPayload: payload.rawPayload, matchedRuleId: r.ruleId, action: 'BLOCKED',
      }});
      return { ...payload, spamCheck: { passed: false, matchedRuleId: r.ruleId } };
    }
  }
  return { ...payload, spamCheck: { passed: true } };
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/spam
git add src/modules/intake/spam/index.ts src/modules/intake/spam/index.test.ts
git commit -m "feat(6a/spam): orchestrator chains 4 layers + writes SpamLog"
```

---

## Phase 4: Normalize module

### Task 14: Field-map AI proposal + retrieval

**Spec ref:** §4.1 (field mapping)

**Files:**
- Create: `src/modules/intake/normalize/field-map.ts`
- Create: `src/modules/intake/normalize/field-map.test.ts`

- [ ] **Step 1: Test**

```typescript
// src/modules/intake/normalize/field-map.test.ts
import { describe, it, expect, vi } from 'vitest';
import { proposeFieldMap, applyFieldMap, detectUnknownKeys } from './field-map';

describe('proposeFieldMap', () => {
  it('asks AI to map raw keys to canonical keys', async () => {
    const map = await proposeFieldMap('t1', { full_name: 'Joe', mobile_no: '+91', email: 'x@y.com' });
    expect(map).toEqual({ full_name: 'name', mobile_no: 'phone', email: 'email' });
  });
});

describe('applyFieldMap', () => {
  it('produces canonical fields from raw via map', () => {
    const c = applyFieldMap(
      { full_name: 'Joe', mobile_no: '+91', email: 'x@y.com' },
      { full_name: 'name', mobile_no: 'phone', email: 'email' },
    );
    expect(c).toEqual({ name: 'Joe', phone: '+91', email: 'x@y.com' });
  });
});

describe('detectUnknownKeys', () => {
  it('flags payload keys not present in fieldMap', () => {
    const u = detectUnknownKeys({ name: 'a', city: 'b' }, { name: 'name' });
    expect(u).toEqual(['city']);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/normalize/field-map.ts
import { getAIProvider } from '@/modules/ai/provider';

export async function proposeFieldMap(tenantId: string, rawPayload: Record<string, unknown>): Promise<Record<string,string>> {
  const provider = await getAIProvider(tenantId);
  const sample = JSON.stringify(rawPayload).slice(0, 2000);
  const prompt = `Given a form submission payload, map each source key to one of these canonical Lead fields: name, phone, email, language, tourCode, notes, tags. If a key doesn't fit, omit it. Return JSON only.\n\nPayload: ${sample}`;
  const r = await provider.completeJson(prompt);
  return (r ?? {}) as Record<string,string>;
}

export function applyFieldMap(raw: Record<string, unknown>, map: Record<string,string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [src, dst] of Object.entries(map)) {
    if (raw[src] !== undefined) out[dst] = raw[src];
  }
  return out;
}

export function detectUnknownKeys(raw: Record<string, unknown>, map: Record<string, string>): string[] {
  return Object.keys(raw).filter(k => !(k in map));
}
```

> **Note:** add a `completeJson(prompt: string): Promise<unknown>` method to the AIProvider interface if not already present.

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/normalize/field-map.test.ts
git add src/modules/intake/normalize/field-map.ts src/modules/intake/normalize/field-map.test.ts src/modules/ai/provider.ts
git commit -m "feat(6a/normalize): field-map propose + apply + key-diff"
```

---

### Task 15: Language detection

**Spec ref:** §1 (hard rules), §2 (pipeline step 2)

**Files:**
- Create: `src/modules/intake/normalize/language-detect.ts`
- Create: `src/modules/intake/normalize/language-detect.test.ts`

- [ ] **Step 1: Test + implement (single TDD cycle, short)**

```typescript
// language-detect.test.ts
import { describe, it, expect, vi } from 'vitest';
import { detectLanguage } from './language-detect';

describe('detectLanguage', () => {
  it('returns ISO 639-1 code via AI', async () => {
    expect(await detectLanguage('t1', 'मुझे गोवा जाना है')).toBe('hi');
    expect(await detectLanguage('t1', 'hello sir, planning a trip')).toBe('en');
  });
  it('returns undefined for empty', async () => {
    expect(await detectLanguage('t1', '')).toBeUndefined();
  });
});
```

```typescript
// language-detect.ts
import { getAIProvider } from '@/modules/ai/provider';

export async function detectLanguage(tenantId: string, text: string): Promise<string | undefined> {
  if (!text?.trim()) return undefined;
  const provider = await getAIProvider(tenantId);
  const prompt = `Identify the primary language of this text and respond with the ISO 639-1 code only (2 letters lowercase). Text: """${text.slice(0, 500)}"""`;
  try {
    const r = (await provider.complete(prompt)).trim().toLowerCase();
    return /^[a-z]{2}$/.test(r) ? r : undefined;
  } catch { return undefined; }
}
```

- [ ] **Step 2: Run + commit**

```bash
npx vitest run src/modules/intake/normalize/language-detect.test.ts
git add src/modules/intake/normalize/language-detect.ts src/modules/intake/normalize/language-detect.test.ts
git commit -m "feat(6a/normalize): AI language detection"
```

---

### Task 16: Normalize orchestrator + re-confirmation debounce

**Spec ref:** §4.1 (re-confirmation trigger)

**Files:**
- Create: `src/modules/intake/normalize/index.ts`
- Create: `src/modules/intake/normalize/index.test.ts`

- [ ] **Step 1: Test cases — known IntakeForm path, unknown form path (creates PENDING_REVIEW), key-diff notification (debounced)**

(write 3 tests covering: applies existing confirmed fieldMap; creates IntakeForm in PENDING_REVIEW on unknown source/externalId; raises notification at most once per 24h when unknown keys appear.)

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/normalize/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { proposeFieldMap, applyFieldMap, detectUnknownKeys } from './field-map';
import { detectLanguage } from './language-detect';

export async function normalize(payload: IntakePayload): Promise<IntakePayload> {
  // Identify IntakeForm (caller resolves source/externalId before calling pipeline; carried via intakeFormId or rawPayload._form)
  let form = payload.intakeFormId
    ? await prisma.intakeForm.findUnique({ where: { id: payload.intakeFormId } })
    : null;

  if (!form && (payload.rawPayload as any)._externalId) {
    const externalId = String((payload.rawPayload as any)._externalId);
    const proposed = await proposeFieldMap(payload.tenantId, payload.rawPayload);
    form = await prisma.intakeForm.create({ data: {
      tenantId: payload.tenantId, source: payload.source, externalId,
      name: `Auto: ${payload.source} ${externalId.slice(0, 12)}`,
      fieldMap: proposed, fieldMappingConfirmed: false, status: 'PENDING_REVIEW',
    }});
    await prisma.notification.create({ data: {
      tenantId: payload.tenantId, type: 'INTAKE_FORM_PENDING_REVIEW',
      title: 'New form awaiting field-map review', severity: 'INFO',
      meta: { intakeFormId: form.id },
    }});
  }

  const map = (form?.fieldMap as Record<string, string>) ?? {};
  const canonical = applyFieldMap(payload.rawPayload, map);

  // tag seeding
  if (form?.defaultTagIds?.length) canonical.tags = [...form.defaultTagIds];

  // language detection on any text
  const text = String(canonical.notes ?? canonical.message ?? '');
  canonical.language = await detectLanguage(payload.tenantId, text);

  // key-diff debounced re-confirmation
  if (form?.fieldMappingConfirmed) {
    const unknown = detectUnknownKeys(payload.rawPayload, map);
    if (unknown.length) {
      const dbKey = `intake:keydiff:${form.id}`;
      const setRecently = await redis.set(dbKey, '1', 'EX', 86400, 'NX');
      if (setRecently === 'OK') {
        await prisma.notification.create({ data: {
          tenantId: payload.tenantId, type: 'INTAKE_FORM_KEY_DIFF',
          title: `New keys on ${form.name}: ${unknown.join(', ')}`,
          severity: 'WARN', meta: { intakeFormId: form.id, unknown },
        }});
      }
    }
  }

  return { ...payload, intakeFormId: form?.id, canonicalFields: canonical as any };
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/normalize
git add src/modules/intake/normalize
git commit -m "feat(6a/normalize): orchestrator with PENDING_REVIEW + 24h-debounced key-diff"
```

---

## Phase 5: Dedup module

### Task 17: Phone/email match + activity append

**Spec ref:** §4.1 (dedup section)

**Files:**
- Create: `src/modules/intake/dedup/index.ts`
- Create: `src/modules/intake/dedup/dedup.test.ts`

- [ ] **Step 1: Tests**

```typescript
// dedup.test.ts
import { describe, it, expect } from 'vitest';
import { dedupCheck } from './index';
import { prisma } from '@/lib/prisma';

describe('dedupCheck', () => {
  it('returns existing leadId on phone match within tenant', async () => { /* seed Customer + Lead, then check */ });
  it('returns existing leadId on email match within tenant', async () => { /* … */ });
  it('returns no match when phone/email differ', async () => { /* … */ });
  it('does NOT match across tenants', async () => { /* … */ });
  it('appends LeadActivity { type: REPEAT_INQUIRY } when match', async () => { /* … */ });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/dedup/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';

export async function dedupCheck(payload: IntakePayload): Promise<IntakePayload> {
  const phone = payload.canonicalFields?.phone ?? payload.sender.phone;
  const email = payload.canonicalFields?.email ?? payload.sender.email;
  if (!phone && !email) return payload;

  const existing = await prisma.lead.findFirst({
    where: {
      tenantId: payload.tenantId,
      customer: {
        OR: [
          phone ? { phone } : undefined,
          email ? { email } : undefined,
        ].filter(Boolean) as any,
      },
    },
    orderBy: { createdAt: 'desc' },
    include: { customer: true },
  });

  if (!existing) return payload;

  await prisma.leadActivity.create({ data: {
    leadId: existing.id, type: 'REPEAT_INQUIRY',
    source: payload.source as any,
    meta: { rawPayload: payload.rawPayload, intakeFormId: payload.intakeFormId },
  }});

  return { ...payload, dedupResult: { existingLeadId: existing.id, existingCustomerId: existing.customerId } };
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/dedup
git add src/modules/intake/dedup
git commit -m "feat(6a/dedup): strict-merge by phone OR email + REPEAT_INQUIRY activity"
```

> **Note:** LeadActivity already exists; verify `REPEAT_INQUIRY` is a valid `LeadActivityType` enum value. If not, add it in a follow-up enum-extension migration (small) before this commit, or extend Task 6.

---

### Task 18: Race-condition protection

**Spec ref:** §4.1 (race), §7

**Files:**
- Modify: `src/modules/intake/dedup/index.ts`
- Create: `src/modules/intake/dedup/race.test.ts`

- [ ] **Step 1: Add concurrency test using `Promise.all`**

```typescript
// race.test.ts
import { describe, it, expect } from 'vitest';
import { dedupCheck } from './index';
import { prisma } from '@/lib/prisma';

describe('dedupCheck — race', () => {
  it('two concurrent intakes with same phone yield exactly one Customer + one Lead', async () => {
    const payload = (i: number): any => ({
      tenantId: 't-race', source: 'WHATSAPP',
      sender: { phone: '+919000000001' }, rawPayload: { i },
      canonicalFields: { phone: '+919000000001', name: 'X' },
    });
    await Promise.all([dedupCheck(payload(1)), dedupCheck(payload(2))]);
    const customers = await prisma.customer.findMany({ where: { tenantId: 't-race', phone: '+919000000001' } });
    expect(customers.length).toBe(1);
  });
});
```

- [ ] **Step 2: Verify migration 006's partial unique indexes are doing the work; if test fails, add Prisma upsert wrapper around customer creation in dispatch (Task 31)**

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/dedup/race.test.ts
git commit -m "test(6a/dedup): concurrent intake produces single customer (relies on unique indexes)"
```

---

## Phase 6: Department resolver

### Task 19: 3-tier resolution

**Spec ref:** §4 step 4 (Department resolver), Q7 = (d)

**Files:**
- Create: `src/modules/intake/department/index.ts`
- Create: `src/modules/intake/department/resolve.test.ts`

- [ ] **Step 1: Tests (one per tier)**

```typescript
describe('resolveDepartment', () => {
  it('uses explicit department_id from canonicalFields when present', async () => { /* expect dept = 'd-explicit' */ });
  it('falls back to IntakeForm.departmentId when no explicit', async () => { /* expect dept = form.departmentId */ });
  it('falls back to AI classification when no IntakeForm dept set', async () => { /* mock AI returns 'd-ai' */ });
  it('returns null when all tiers fail (assignment will catch-all)', async () => { /* … */ });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/department/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';
import { getAIProvider } from '@/modules/ai/provider';

export async function resolveDepartment(payload: IntakePayload): Promise<IntakePayload> {
  const explicit = (payload.canonicalFields as any)?.department_id ?? (payload.rawPayload as any)?.department_id;
  if (explicit) {
    const d = await prisma.department.findFirst({ where: { id: String(explicit), tenantId: payload.tenantId } });
    if (d) return { ...payload, departmentId: d.id };
  }

  if (payload.intakeFormId) {
    const f = await prisma.intakeForm.findUnique({ where: { id: payload.intakeFormId } });
    if (f?.departmentId) return { ...payload, departmentId: f.departmentId };
  }

  // AI fallback
  const depts = await prisma.department.findMany({ where: { tenantId: payload.tenantId, isActive: true }, select: { id: true, name: true, description: true } });
  if (!depts.length) return payload;
  const provider = await getAIProvider(payload.tenantId);
  const text = String((payload.canonicalFields as any)?.notes ?? '');
  const prompt = `Classify this customer enquiry into ONE of these departments (return JSON { departmentId: string, confidence: number 0-1 }):\n${JSON.stringify(depts)}\nEnquiry: ${text}`;
  try {
    const r = await provider.completeJson(prompt) as { departmentId?: string; confidence?: number };
    if (r?.departmentId && (r.confidence ?? 0) >= 0.5 && depts.some(d => d.id === r.departmentId)) {
      return { ...payload, departmentId: r.departmentId };
    }
  } catch {}
  return payload;
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/department
git add src/modules/intake/department
git commit -m "feat(6a/department): 3-tier resolve (explicit → IntakeForm → AI)"
```

---

## Phase 7: Tour module

### Task 20: Tour matcher (explicit code → AI catalog match)

**Spec ref:** §4.3 (tour matcher)

**Files:**
- Create: `src/modules/intake/tour/matcher.ts`
- Create: `src/modules/intake/tour/matcher.test.ts`

- [ ] **Step 1: Tests** (explicit code → match; AI ≥0.8 → match; AI <0.8 → null)

- [ ] **Step 2: Implement**

```typescript
// matcher.ts
import { prisma } from '@/lib/prisma';
import type { IntakePayload } from '../types';
import { getAIProvider } from '@/modules/ai/provider';

const AI_THRESHOLD = 0.8;

export async function matchTour(payload: IntakePayload): Promise<IntakePayload> {
  const code = (payload.canonicalFields as any)?.tourCode;
  if (code) {
    const t = await prisma.tour.findUnique({ where: { tenantId_code: { tenantId: payload.tenantId, code: String(code) } } });
    if (t) return { ...payload, tourMatch: { tourId: t.id, confidence: 1, soldOut: t.status === 'SOLD_OUT' } };
  }

  const tours = await prisma.tour.findMany({
    where: { tenantId: payload.tenantId, status: { in: ['ACTIVE', 'SOLD_OUT'] }, ...(payload.departmentId ? { departmentId: payload.departmentId } : {}) },
    select: { id: true, code: true, name: true, startDate: true, endDate: true, status: true, tagIds: true },
  });
  if (!tours.length) return payload;

  const text = String((payload.canonicalFields as any)?.notes ?? '');
  if (!text) return payload;

  try {
    const r = await (await getAIProvider(payload.tenantId)).completeJson(
      `Match this customer enquiry to the best tour. Return JSON { tourId: string, confidence: 0-1 }. Tours: ${JSON.stringify(tours)}. Enquiry: ${text}`
    ) as { tourId?: string; confidence?: number };
    if (r?.tourId && (r.confidence ?? 0) >= AI_THRESHOLD) {
      const t = tours.find(x => x.id === r.tourId);
      if (t) {
        const tags = [...(payload.canonicalFields?.tags ?? []), ...t.tagIds];
        return { ...payload,
          canonicalFields: { ...(payload.canonicalFields ?? {}), tags },
          tourMatch: { tourId: t.id, confidence: r.confidence!, soldOut: t.status === 'SOLD_OUT' },
        };
      }
    }
  } catch {}
  return payload;
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/modules/intake/tour/matcher.test.ts
git add src/modules/intake/tour/matcher.ts src/modules/intake/tour/matcher.test.ts
git commit -m "feat(6a/tour): explicit-code + AI catalog matcher (≥0.8)"
```

---

### Task 21: Sold-out auto-flip via Prisma middleware

**Spec ref:** §4.3 (sold count)

**Files:**
- Create: `src/lib/prisma-middleware-tour-sold.ts`
- Modify: `src/lib/prisma.ts` (wire middleware)
- Create: `src/lib/prisma-middleware-tour-sold.test.ts`

- [ ] **Step 1: Test (TourBooking create → Tour.sold increments → flips to SOLD_OUT when capacity reached)**

- [ ] **Step 2: Implement middleware that runs on `TourBooking.create | update | delete` and recomputes Tour.sold + status**

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/lib/prisma-middleware-tour-sold.test.ts
git add src/lib/prisma-middleware-tour-sold.ts src/lib/prisma.ts src/lib/prisma-middleware-tour-sold.test.ts
git commit -m "feat(6a/tour): auto-recompute sold + flip SOLD_OUT on booking writes"
```

---

### Task 22: AI waitlist mini-flow + tour orchestrator

**Spec ref:** §4.3 (sold-out routing behavior)

**Files:**
- Create: `src/modules/intake/tour/waitlist-flow.ts`
- Create: `src/modules/intake/tour/waitlist-flow.test.ts`
- Create: `src/modules/intake/tour/index.ts`

- [ ] **Step 1: Tests** — `waitlist-flow.test.ts` covers: (a) generates message asking waitlist/alternatives/agent, (b) records LeadActivity, (c) tolerates AI failure (still proceeds).

- [ ] **Step 2: Implement waitlist-flow.ts** — single LLM call; returns the templated message text + recorded intent (waitlist | alternatives | agent | unknown). On failure return null and let pipeline continue without mini-flow.

- [ ] **Step 3: Tour orchestrator `index.ts`** — calls `matchTour` → if matched + soldOut: adds `sold-out` tag + sets `priority: HIGH` on payload → fires waitlist-flow (writes outbound message via existing Conversation/Message infra) → returns payload for next stage.

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/modules/intake/tour
git add src/modules/intake/tour
git commit -m "feat(6a/tour): waitlist mini-flow + orchestrator with HIGH-priority sold-out tag"
```

---

## Phase 8: Assignment module

### Task 23: Base eligible-pool query

**Spec ref:** §4.2 (base filter)

**Files:**
- Create: `src/modules/intake/assignment/eligible.ts`
- Create: `src/modules/intake/assignment/eligible.test.ts`

- [ ] **Step 1: Tests** — returns active AGENTs in dept; excludes `isActive=false`; excludes those with `onLeaveUntil > now()`; returns empty array if none.

- [ ] **Step 2: Implement**

```typescript
// eligible.ts
import { prisma } from '@/lib/prisma';

export async function getEligibleAgents(tenantId: string, departmentId: string | undefined) {
  const now = new Date();
  return prisma.user.findMany({
    where: {
      tenantId, role: 'AGENT', isActive: true,
      ...(departmentId ? { departmentId } : {}),
      OR: [{ onLeaveUntil: null }, { onLeaveUntil: { lt: now } }],
    },
    select: { id: true, languages: true, tags: true, assignmentTier: true, departmentId: true },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/assignment/eligible.ts src/modules/intake/assignment/eligible.test.ts
git commit -m "feat(6a/assignment): base eligible-pool query with onLeave skip"
```

---

### Task 24: Round-robin strategy + cursor with advisory lock

**Spec ref:** §4.2 (concurrency)

**Files:**
- Create: `src/modules/intake/assignment/cursor.ts`
- Create: `src/modules/intake/assignment/cursor.test.ts`
- Create: `src/modules/intake/assignment/strategies/round-robin.ts`
- Create: `src/modules/intake/assignment/strategies/round-robin.test.ts`

- [ ] **Step 1: Tests**
  - `cursor.test.ts`: advances correctly under sequential calls; under concurrent calls (Promise.all 20), all 20 advances are unique (no double-assign to same agent)
  - `round-robin.test.ts`: 6 leads / 3 agents → 2-2-2 distribution

- [ ] **Step 2: Implement cursor with Postgres advisory lock**

```typescript
// cursor.ts
import { prisma } from '@/lib/prisma';

function lockKey(tenantId: string, scope: string): bigint {
  // hash to bigint for pg_advisory_xact_lock
  let h = 0n;
  for (const ch of `${tenantId}:${scope}`) h = (h * 131n + BigInt(ch.charCodeAt(0))) & ((1n << 63n) - 1n);
  return h;
}

export async function nextAgentFromCursor(tenantId: string, scope: string, agentIds: string[]): Promise<string | null> {
  if (!agentIds.length) return null;
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey(tenantId, scope)}::bigint)`);
    const cursor = await tx.assignmentCursor.findUnique({ where: { tenantId_scope: { tenantId, scope } } });
    const lastIdx = cursor?.lastAgentId ? agentIds.indexOf(cursor.lastAgentId) : -1;
    const nextIdx = (lastIdx + 1) % agentIds.length;
    const pick = agentIds[nextIdx];
    await tx.assignmentCursor.upsert({
      where: { tenantId_scope: { tenantId, scope } },
      update: { lastAgentId: pick },
      create: { tenantId, scope, lastAgentId: pick },
    });
    return pick;
  });
}
```

- [ ] **Step 3: Implement round-robin strategy**

```typescript
// strategies/round-robin.ts
import type { IntakePayload } from '../../types';
import { getEligibleAgents } from '../eligible';
import { nextAgentFromCursor } from '../cursor';

export async function roundRobin(payload: IntakePayload): Promise<string | null> {
  const agents = await getEligibleAgents(payload.tenantId, payload.departmentId);
  const ids = agents.map(a => a.id);
  return nextAgentFromCursor(payload.tenantId, `dept:${payload.departmentId ?? 'none'}`, ids);
}
```

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/modules/intake/assignment/cursor.test.ts src/modules/intake/assignment/strategies/round-robin.test.ts
git add src/modules/intake/assignment/cursor.ts src/modules/intake/assignment/cursor.test.ts src/modules/intake/assignment/strategies/round-robin.ts src/modules/intake/assignment/strategies/round-robin.test.ts
git commit -m "feat(6a/assign): round-robin + advisory-lock cursor"
```

---

### Task 25: Load-balanced strategy

**Spec ref:** §4.2 (LOAD_BALANCED row)

**Files:**
- Create: `src/modules/intake/assignment/strategies/load-balanced.ts` + test

- [ ] **Step 1: Test — agent with min open-lead count wins; ties broken by least-recent assignedAt**

- [ ] **Step 2: Implement (raw SQL count grouped by assignee_id, JOIN to filter eligible agents)**

```sql
SELECT u.id, COUNT(l.id) AS open_count, MAX(l.assigned_at) AS last_assigned
FROM users u
LEFT JOIN leads l ON l.assignee_id = u.id
  AND l.status NOT IN ('WON','LOST','CLOSED')
WHERE u.tenant_id = $1 AND u.role = 'AGENT' AND u.is_active = true
  AND (u.on_leave_until IS NULL OR u.on_leave_until < now())
  AND u.department_id = $2
GROUP BY u.id
ORDER BY open_count ASC, last_assigned ASC NULLS FIRST
LIMIT 1
```

- [ ] **Step 3: Run + commit**

```bash
git add src/modules/intake/assignment/strategies/load-balanced.ts src/modules/intake/assignment/strategies/load-balanced.test.ts
git commit -m "feat(6a/assign): load-balanced strategy (min open + LRA tiebreaker)"
```

---

### Task 26: Skill-based strategy

**Spec ref:** §4.2 (SKILL_BASED), §4.2 clarification (tags/language origin)

**Files:**
- Create: `src/modules/intake/assignment/strategies/skill-based.ts` + test

- [ ] **Step 1: Test — agents intersected by language and/or tags; empty intersection → falls back to base eligible (round-robin within)**

- [ ] **Step 2: Implement** — fetch eligible, filter by `agent.languages.includes(payload.canonicalFields?.language)` OR `agent.tags ∩ payload.canonicalFields?.tags ≠ ∅`; if empty pool, return base eligible. Then call `nextAgentFromCursor` with scope `dept:<id>:skill:<lang>:<tags-sorted-csv>`.

- [ ] **Step 3: Run + commit**

```bash
git add src/modules/intake/assignment/strategies/skill-based.ts src/modules/intake/assignment/strategies/skill-based.test.ts
git commit -m "feat(6a/assign): skill/language/tag-based strategy with empty-pool fallback"
```

---

### Task 27: AI-tiered strategy

**Spec ref:** §4.2 (AI_TIERED), Q5 (admin-configurable)

**Files:**
- Create: `src/modules/intake/assignment/strategies/ai-tiered.ts` + test

- [ ] **Step 1: Test** — given config `{ tierCount: 3, cutoffs: [80, 40] }` and lead score 85 → routes within tier-1 agents (load-balanced); empty tier-3 → cascades to tier-2

- [ ] **Step 2: Implement** — read `AssignmentStrategy.config`; ensure LeadScore exists (use existing `LeadScore` model + scoring service from Phase 5); compute tier; intersect eligible × `assignmentTier=N`; load-balance within; cascade to lower tier on empty.

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/assignment/strategies/ai-tiered.ts src/modules/intake/assignment/strategies/ai-tiered.test.ts
git commit -m "feat(6a/assign): AI-tiered strategy with configurable cutoffs + tier cascade"
```

---

### Task 28: Named-pools strategy

**Spec ref:** §4.2 (NAMED_POOLS), Q4 (multi-pool + source/dept routing)

**Files:**
- Create: `src/modules/intake/assignment/strategies/named-pools.ts` + test

- [ ] **Step 1: Test** — pool A matches source=META_LEAD_AD → only pool-A agents considered; pool B matches departmentId=X; no pool matches → fall through to base eligible

- [ ] **Step 2: Implement** — iterate `AssignmentPool where isActive` ORDER BY priority DESC. First pool whose `sourceMatch` JSON contains payload.source OR departmentId == payload.departmentId → use that pool's `agentIds ∩ base eligible`. Round-robin within (`scope: pool:<id>`).

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/assignment/strategies/named-pools.ts src/modules/intake/assignment/strategies/named-pools.test.ts
git commit -m "feat(6a/assign): named-pools strategy with priority-ordered source/dept routing"
```

---

### Task 29: Fallback ladder

**Spec ref:** §4.2 (Fallback ladder)

**Files:**
- Create: `src/modules/intake/assignment/fallback.ts` + test

- [ ] **Step 1: Test** — empty strategy pool → base eligible round-robin; empty base → assigns to COMPANY_ADMIN + creates Notification

- [ ] **Step 2: Implement**

```typescript
// fallback.ts
import { prisma } from '@/lib/prisma';
import { getEligibleAgents } from './eligible';
import { nextAgentFromCursor } from './cursor';

export async function fallbackAssign(tenantId: string, departmentId?: string): Promise<{ agentId: string; reason: string }> {
  const eligible = await getEligibleAgents(tenantId, departmentId);
  if (eligible.length) {
    const id = await nextAgentFromCursor(tenantId, `dept:${departmentId ?? 'none'}`, eligible.map(a => a.id));
    if (id) return { agentId: id, reason: 'fallback:dept-rr' };
  }
  const admin = await prisma.user.findFirst({ where: { tenantId, role: 'COMPANY_ADMIN', isActive: true } });
  if (!admin) throw new Error(`No COMPANY_ADMIN available for tenant ${tenantId}`);
  const admins = await prisma.user.findMany({ where: { tenantId, role: 'COMPANY_ADMIN', isActive: true }, select: { id: true } });
  await Promise.all(admins.map(a => prisma.notification.create({ data: {
    tenantId, userId: a.id, type: 'ASSIGNMENT_FALLBACK', severity: 'HIGH',
    title: `Lead routed to admin: no active agents in ${departmentId ?? '(no dept)'}`,
  }})));
  return { agentId: admin.id, reason: 'fallback:company-admin' };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/assignment/fallback.ts src/modules/intake/assignment/fallback.test.ts
git commit -m "feat(6a/assign): fallback ladder ending at COMPANY_ADMIN + admin notifications"
```

---

### Task 30: Assignment orchestrator

**Spec ref:** §4.2 (entry point)

**Files:**
- Create: `src/modules/intake/assignment/index.ts` + test

- [ ] **Step 1: Tests** — reads `AssignmentStrategy.type`, dispatches to the right strategy, applies fallback, writes Lead.assigneeId + LeadActivity

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/assignment/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';
import { roundRobin } from './strategies/round-robin';
import { loadBalanced } from './strategies/load-balanced';
import { skillBased } from './strategies/skill-based';
import { aiTiered } from './strategies/ai-tiered';
import { namedPools } from './strategies/named-pools';
import { fallbackAssign } from './fallback';

export async function assignLead(payload: IntakePayload): Promise<IntakePayload> {
  if (!payload.leadId) throw new Error('assignLead: leadId required (set by dispatch step pre-call OR by orchestrator);');
  const strategy = await prisma.assignmentStrategy.findUnique({ where: { tenantId: payload.tenantId } });
  let assignee: string | null = null;
  let reason = 'unknown';
  if (strategy) {
    const fn = ({
      ROUND_ROBIN: roundRobin,
      LOAD_BALANCED: loadBalanced,
      SKILL_BASED: skillBased,
      AI_TIERED: aiTiered,
      NAMED_POOLS: namedPools,
    } as const)[strategy.type];
    assignee = await fn(payload);
    reason = `strategy:${strategy.type}`;
  }
  if (!assignee) {
    const fb = await fallbackAssign(payload.tenantId, payload.departmentId);
    assignee = fb.agentId; reason = fb.reason;
  }
  await prisma.lead.update({ where: { id: payload.leadId }, data: { assigneeId: assignee } });
  await prisma.leadActivity.create({ data: {
    leadId: payload.leadId, type: 'ASSIGNED' as any,
    meta: { strategy: strategy?.type ?? 'NONE', reason, assigneeId: assignee },
  }});
  return payload;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/assignment/index.ts src/modules/intake/assignment/index.test.ts
git commit -m "feat(6a/assign): orchestrator dispatches by tenant strategy + fallback"
```

---

## Phase 9: Dispatch module

### Task 31: Open conversation + notify (creates Lead first if dedup didn't)

**Spec ref:** §2 (step 7), §4.1 (dedup branch returns existing)

**Files:**
- Create: `src/modules/intake/dispatch/index.ts` + test

- [ ] **Step 1: Tests** — creates Customer if none, creates Lead (status=NEW or INTAKE_PENDING_REVIEW if field-map unconfirmed), creates Conversation + initial Message from raw payload, emits WS event + Notification to assignee

- [ ] **Step 2: Implement**

```typescript
// src/modules/intake/dispatch/index.ts
import type { IntakePayload } from '../types';
import { prisma } from '@/lib/prisma';

export async function dispatch(payload: IntakePayload): Promise<IntakePayload> {
  if (payload.dedupResult?.existingLeadId) return payload; // dedup already handled it

  const cf = payload.canonicalFields ?? {};
  // upsert Customer
  const customer = await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId: payload.tenantId, phone: String(cf.phone ?? payload.sender.phone ?? `unknown-${payload.webhookLogId}`) } },
    update: { name: String(cf.name ?? '') || undefined, email: cf.email ? String(cf.email) : undefined },
    create: {
      tenantId: payload.tenantId,
      name: String(cf.name ?? 'Unknown'),
      phone: cf.phone ? String(cf.phone) : null,
      email: cf.email ? String(cf.email) : null,
    },
  });

  const form = payload.intakeFormId ? await prisma.intakeForm.findUnique({ where: { id: payload.intakeFormId } }) : null;
  const needsReview = form ? !form.fieldMappingConfirmed : false;

  const lead = await prisma.lead.create({ data: {
    tenantId: payload.tenantId,
    customerId: customer.id,
    source: payload.source,
    status: needsReview ? 'INTAKE_PENDING_REVIEW' : 'NEW',
    priority: payload.tourMatch?.soldOut ? 'HIGH' : 'MEDIUM',
    language: cf.language ? String(cf.language) : null,
    tourId: payload.tourMatch?.tourId ?? null,
    intakeFormId: form?.id ?? null,
    departmentId: payload.departmentId ?? null,
  }});

  const conv = await prisma.conversation.create({ data: {
    tenantId: payload.tenantId, leadId: lead.id, customerId: customer.id,
    channel: payload.source as any,
  }});

  await prisma.message.create({ data: {
    conversationId: conv.id, direction: 'INBOUND',
    body: String(cf.notes ?? JSON.stringify(payload.rawPayload).slice(0, 1000)),
    sentAt: new Date(),
  }});

  await prisma.intakeWebhookLog.update({ where: { id: payload.webhookLogId }, data: { processed: true, leadId: lead.id } });

  return { ...payload, leadId: lead.id };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/intake/dispatch
git commit -m "feat(6a/dispatch): upsert customer + create lead + conversation + log resolution"
```

---

## Phase 10: Intake webhook routes

### Task 32: Universal intake webhook `/api/webhooks/intake/{tenantToken}`

**Spec ref:** §4.1, §5

**Files:**
- Create: `src/app/api/webhooks/intake/[tenantToken]/route.ts`
- Create: `src/app/api/webhooks/intake/[tenantToken]/route.test.ts`

- [ ] **Step 1: Tests** — token resolves to tenant, IntakeWebhookLog created, pipeline invoked, returns 200 on success, 401 on bad token. Bonus: writes raw payload with `signatureValid=false` and rejects when source supports signing but signature header missing/invalid.

- [ ] **Step 2: Implement** — resolve tenant by `tenantToken` (new field on Tenant; if not present, add to migration 001 — `Tenant.intakeToken String @unique`). Verify signature when source-specific header present. Log raw + invoke `runPipeline` with all stages wired.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/intake src/lib/intake-token.ts prisma
git commit -m "feat(6a/api): POST /api/webhooks/intake/{tenantToken} universal intake"
```

> **Schema follow-up:** Add `Tenant.intakeToken String @unique @default(cuid())` to migration 001 or in a small follow-up migration; regenerate Prisma Client.

---

### Task 33: Meta leadgen webhook

**Spec ref:** §4.1 (Meta), §5

**Files:**
- Create: `src/app/api/webhooks/meta/leadgen/route.ts`
- Create: `src/app/api/webhooks/meta/leadgen/route.test.ts`

- [ ] **Step 1: Tests** — verifies Meta signature, GET handler returns hub.challenge during subscription verification, POST resolves page → tenant via `ChannelConfig`, fetches lead from Graph API (mocked), enqueues into pipeline

- [ ] **Step 2: Implement** — implement both `GET` (subscription verify) and `POST` (event delivery). Use existing encrypted `ChannelConfig.config` to read access token.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/meta src/lib/meta-graph.ts
git commit -m "feat(6a/api): POST /api/webhooks/meta/leadgen — Meta lead-ads ingestion"
```

---

### Task 34: Google Forms webhook

**Spec ref:** §4.1 (Google), §5

**Files:**
- Create: `src/app/api/webhooks/google-forms/[tenantToken]/route.ts` + test
- Create: `docs/intake/google-forms-template.gs`

- [ ] **Step 1: Tests** — HMAC-signed payloads accepted, unsigned/invalid → 401, valid → IntakeWebhookLog + pipeline

- [ ] **Step 2: Implement** — verify HMAC of body against a per-tenant key (`Tenant.googleFormsKey String? @unique`)

- [ ] **Step 3: Create Apps Script template** — 15-line .gs file at `docs/intake/google-forms-template.gs` with placeholders for `TENANT_TOKEN` + `SIGNING_KEY`; commit with README explanation

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/google-forms docs/intake/google-forms-template.gs
git commit -m "feat(6a/api): Google Forms intake + signed Apps Script template"
```

---

## Phase 11: Admin API routes

> Tasks 35-42 follow a uniform CRUD pattern. Each task gets one TDD cycle covering one happy-path + one RBAC denial + one tenant-isolation test, then a commit. Specs all under §5.

### Task 35: IntakeForm CRUD + field-map endpoints

- [ ] **Files:** `src/app/api/intake-forms/route.ts`, `src/app/api/intake-forms/[id]/route.ts`, `src/app/api/intake-forms/[id]/field-map/route.ts`, `src/app/api/intake-forms/[id]/test/route.ts` + tests
- [ ] **Tests:** list with pagination; create; rename + pause/activate; field-map GET (return current map + raw payload sample); field-map PATCH (admin confirm); test endpoint replays last `IntakeWebhookLog.rawPayload` through `runPipeline` with `dryRun=true`
- [ ] **Commit:** `feat(6a/api): intake-forms CRUD + field-map + test replay`

### Task 36: Assignment strategy GET/PUT

- [ ] **Files:** `src/app/api/assignment-strategy/route.ts` + test
- [ ] **Tests:** GET returns null when unset; PUT validates type + config schema (one zod schema per type)
- [ ] **Commit:** `feat(6a/api): assignment-strategy GET/PUT`

### Task 37: Assignment pools CRUD

- [ ] **Files:** `src/app/api/assignment-pools/route.ts`, `src/app/api/assignment-pools/[id]/route.ts` + tests
- [ ] **Tests:** create with agentIds validation (all must be AGENTs of same tenant); priority ordering preserved
- [ ] **Commit:** `feat(6a/api): assignment-pools CRUD`

### Task 38: Agents picker endpoint

- [ ] **Files:** `src/app/api/users/agents/route.ts` + test
- [ ] **Tests:** filters by `departmentId` and `isActive`; returns `id, name, email, departmentId, openLeadCount, lastSeenAt`
- [ ] **Commit:** `feat(6a/api): /api/users/agents picker source`

### Task 39: Tours + bookings CRUD

- [ ] **Files:** `src/app/api/tours/route.ts`, `src/app/api/tours/[id]/route.ts`, `src/app/api/tours/[id]/bookings/route.ts`, `src/app/api/tours/[id]/bookings/[bookingId]/route.ts` + tests
- [ ] **Tests:** unique code per tenant; capacity ≥1 validation; booking create writes TourBooking + triggers middleware sold-count recompute (already wired in Task 21); cancellation reverses sold-out flip
- [ ] **Commit:** `feat(6a/api): tours + bookings CRUD`

### Task 40: SpamRule CRUD + SpamLog list

- [ ] **Files:** `src/app/api/spam-rules/route.ts`, `src/app/api/spam-rules/[id]/route.ts`, `src/app/api/spam-logs/route.ts` + tests
- [ ] **Tests:** rule type-specific validation (RATE_LIMIT requires threshold+windowSeconds+blockSeconds; AI requires aiThreshold; PATTERN validates regex compiles); SpamLog list paginated with date+channel filters
- [ ] **Commit:** `feat(6a/api): spam-rules CRUD + spam-logs viewer`

### Task 41: Mark-as-spam endpoint

- [ ] **Files:** `src/app/api/conversations/[id]/mark-spam/route.ts` + test
- [ ] **Tests:** body validates `{ channels: string[], departmentIds: string[] }`; creates SpamRule with those scopes; bulk-soft-deletes open messages from sender; returns the created rule
- [ ] **Commit:** `feat(6a/api): POST /api/conversations/{id}/mark-spam with multi-select scopes`

### Task 42: Tags CRUD

- [ ] **Files:** `src/app/api/tags/route.ts`, `src/app/api/tags/[id]/route.ts` + tests
- [ ] **Tests:** unique per (tenantId, name, scope); scope filter on GET
- [ ] **Commit:** `feat(6a/api): tags CRUD (shared with 6b)`

---

## Phase 12: Settings UI

### Task 43: `/settings/intake-forms` list + detail + field-map editor

**Spec ref:** §6

**Files:**
- Create: `src/app/(dashboard)/settings/intake-forms/page.tsx`
- Create: `src/app/(dashboard)/settings/intake-forms/[id]/page.tsx`
- Create: `src/components/intake/FieldMapEditor.tsx`
- Create: `src/components/intake/IntakeFormStatusBadge.tsx`
- Create: `e2e/intake-form-config.spec.ts`

- [ ] **Step 1: Build list page** — table (name, source, status badge, last submission, actions); pause/activate toggles; "Test with last payload" button
- [ ] **Step 2: Build detail page** — three sections: basics (name, dept, default tags), field-map editor (raw payload sample on left, mappable canonical keys on right, AI-suggested map pre-filled), recent submissions
- [ ] **Step 3: `FieldMapEditor` component** — drag-and-drop or paired-select UI for raw-key → canonical-key mapping, with "Re-run AI suggestion" button
- [ ] **Step 4: E2E test (Playwright)** — admin creates new form, submits matching test payload via webhook, confirms field-map, lead appears in inbox
- [ ] **Commit:** `feat(6a/ui): /settings/intake-forms list + detail + field-map editor`

### Task 44: `/settings/assignment` strategy picker + per-strategy configs

**Spec ref:** §6 (assignment), §4.2 (per-strategy configs)

**Files:**
- Create: `src/app/(dashboard)/settings/assignment/page.tsx`
- Create: `src/components/intake/StrategyPicker.tsx` (5 radio cards)
- Create: `src/components/intake/AgentMultiSelect.tsx`
- Create: `src/components/intake/PoolManager.tsx` (for NAMED_POOLS)
- Create: `src/components/intake/TierAssignmentGrid.tsx` (for AI_TIERED)
- Create: `e2e/assignment-named-pools.spec.ts`

- [ ] **Step 1: StrategyPicker component** — 5 radio cards showing strategy name, one-line description, "setup required" indicator
- [ ] **Step 2: AgentMultiSelect** — calls `/api/users/agents`, shows checkbox per agent with name + dept + open-lead count + last-seen
- [ ] **Step 3: PoolManager** — list of pools, add new pool (name + source matchers (multiselect of LeadSource enum) + dept (optional select) + agents (multi-select) + priority), drag-to-reorder priority, delete with confirm
- [ ] **Step 4: TierAssignmentGrid** — for AI_TIERED: number-input for cutoffs, +/- buttons for tier count (2 or 3), table of agents with single-tier dropdown per row
- [ ] **Step 5: Assignment page** — pulls/sets `AssignmentStrategy` on save; renders correct sub-component based on selected type
- [ ] **Step 6: E2E** — admin sets NAMED_POOLS with 3 agents, submits 6 webhook intakes, asserts 2-2-2 distribution
- [ ] **Commit:** `feat(6a/ui): /settings/assignment with per-strategy configs`

### Task 45: `/settings/tours` CRUD

**Spec ref:** §6 (tours)

**Files:**
- Create: `src/app/(dashboard)/settings/tours/page.tsx`
- Create: `src/app/(dashboard)/settings/tours/[id]/page.tsx`
- Create: `src/components/intake/TourCapacityBar.tsx`
- Create: `e2e/tour-sold-out.spec.ts`

- [ ] **Step 1: List page** — table with capacity bar, status filter, code/name/dept columns
- [ ] **Step 2: Detail page** — edit form + bookings sub-table (paginated)
- [ ] **Step 3: TourCapacityBar** — visual bar with sold/capacity ratio, colors green/amber/red
- [ ] **Step 4: E2E** — create tour with capacity 2, add 2 bookings via API, intake matches sold-out flow, asserts HIGH priority + tag + AI waitlist message visible
- [ ] **Commit:** `feat(6a/ui): /settings/tours CRUD + capacity visuals`

### Task 46: `/settings/spam` rules + log viewer

**Spec ref:** §6 (spam)

**Files:**
- Create: `src/app/(dashboard)/settings/spam/page.tsx`
- Create: `src/components/intake/SpamRuleForm.tsx`
- Create: `src/components/intake/SpamLogViewer.tsx`

- [ ] **Step 1: Page** — two tabs: Rules + Log
- [ ] **Step 2: Rules tab** — grouped by type, "Add rule" wizard with type-specific fields (rate-limit gets threshold/window/blockDuration; AI gets threshold slider)
- [ ] **Step 3: Log viewer** — date range + channel filter, paginated; click row to see rawPayload
- [ ] **Commit:** `feat(6a/ui): /settings/spam rules + log`

### Task 47: MarkAsSpamModal + Conversations integration

**Spec ref:** §4.4 ("Mark as spam" UI), Q20

**Files:**
- Create: `src/components/intake/MarkAsSpamModal.tsx`
- Modify: `src/app/(dashboard)/conversations/[id]/page.tsx` (add button + modal trigger)
- Create: `e2e/mark-as-spam.spec.ts`

- [ ] **Step 1: Modal component** — two multi-selects (Channels + Departments), pre-filled with sender's known channels + lead's dept, "Apply to all channels/departments" toggle
- [ ] **Step 2: Wire button on Conversation header** — RBAC: AGENT+
- [ ] **Step 3: E2E** — agent marks WhatsApp sender as spam (selecting WA + Email channels, all depts), next submission from same sender on WA blocked, SpamLog entry visible in /settings/spam
- [ ] **Commit:** `feat(6a/ui): MarkAsSpamModal with multi-select channels + departments`

### Task 48: Sidebar / settings nav updates

**Files:**
- Modify: `src/components/dashboard/SettingsNav.tsx` (or equivalent)

- [ ] **Step 1: Add 4 new entries** under existing Settings section: Intake Forms, Assignment, Tours, Spam
- [ ] **Step 2: RBAC-hide for AGENT/VIEWER** (admin/dept-manager only)
- [ ] **Commit:** `feat(6a/ui): nav entries for new settings pages`

---

## Phase 13: External integrations

### Task 49: Snippet.js generation route + content

**Spec ref:** §4.1 (Website snippet)

**Files:**
- Create: `src/app/snippet/[tenantToken]/route.ts` (serves text/javascript)
- Create: `src/lib/snippet/template.ts` (the JS that runs on tenant sites)
- Create: `src/lib/snippet/template.test.ts`

- [ ] **Step 1: Test** — route returns `Content-Type: application/javascript`, body contains tenantToken substitution
- [ ] **Step 2: Implement template** — IIFE that attaches one delegated submit listener on `document`, serializes form fields, computes form selector path, POSTs to `/api/webhooks/intake/{tenantToken}` with `X-Form-Selector` header. Handles redirected forms by `preventDefault` only if response signals capture (`X-Captured: 1`).
- [ ] **Step 3: Commit:** `feat(6a/snippet): /snippet/{tenantToken} delivery + auto-form-discovery template`

### Task 50: Google Forms Apps Script template

**Spec ref:** §4.1 (Google Forms)

**Files:**
- Create: `docs/intake/google-forms-template.gs` (committed in Task 34 already; flesh out here)
- Create: `docs/intake/google-forms-setup.md` (tenant-facing how-to)

- [ ] **Step 1: Final Apps Script template** — 25-30 lines: reads form response, computes HMAC over body, POSTs to `/api/webhooks/google-forms/{tenantToken}` with `X-Signature` header
- [ ] **Step 2: Setup doc** — step-by-step: open Form → Tools → Script editor → paste → set Script Properties → save → install onFormSubmit trigger
- [ ] **Commit:** `docs(6a): google-forms Apps Script template + setup guide`

### Task 51: Meta App registration + ChannelConfig storage

**Spec ref:** §4.1 (Meta)

**Files:**
- Modify: `src/modules/channels/meta.ts` (existing — extend `connectPage()` to subscribe leadgen webhook + store token encrypted)
- Modify: `src/app/(dashboard)/settings/channels/page.tsx` (add "Lead Ads" toggle per connected Page)
- Create: `docs/intake/meta-setup.md` (one-time platform admin guide)

- [ ] **Step 1: Extend `connectPage`** — after OAuth, POST to `/{page-id}/subscribed_apps?subscribed_fields=leadgen` with the page access token
- [ ] **Step 2: UI toggle** — admin can enable/disable lead-ads per Page; disable unsubscribes via Graph API
- [ ] **Step 3: Platform admin doc** — one-time Meta App setup (App ID, App Secret, callback URLs, Page-level lead_retrieval permission request)
- [ ] **Commit:** `feat(6a/meta): leadgen subscription + per-page toggle + setup doc`

---

## Phase 14: E2E + load tests

### Task 52: E2E intake pipeline — happy path per source

**Files:**
- Create: `e2e/intake-pipeline.spec.ts` (or extend existing intake-form-config from Task 43)

- [ ] **Step 1:** Spin up local dev DB clone; seed 1 tenant, 1 dept, 3 agents, 1 IntakeForm in ACTIVE with confirmed map; assert each source variant lands a Lead in agent inbox via the snippet/manual webhook
- [ ] **Step 2: Commit:** `test(6a/e2e): intake pipeline happy paths per source`

### Task 53: Already covered by Tasks 43/44/45/47 E2E specs — sanity check

- [ ] Run all e2e specs together: `npx playwright test e2e/intake-*.spec.ts e2e/assignment-*.spec.ts e2e/tour-*.spec.ts e2e/mark-as-spam.spec.ts`
- [ ] Fix any flakes; commit fixes individually

### Task 54: Load test — dedup correctness

**Spec ref:** §8

**Files:**
- Create: `tests/load/intake-burst-dedup.test.ts`

- [ ] **Step 1:** Generate 50 unique senders × 2 submissions each = 100 concurrent intakes via direct POST to `/api/webhooks/intake/{tenantToken}` (use k6 or simple `Promise.all` Node script)
- [ ] **Step 2:** Assert exactly 50 new Leads created, 50 `LeadActivity { type: REPEAT_INQUIRY }`, exactly 50 unique Customers (no duplicate phones)
- [ ] **Commit:** `test(6a/load): dedup correctness under 100 concurrent intakes`

### Task 55: Load test — distribution evenness

**Spec ref:** §8

**Files:**
- Create: `tests/load/intake-burst-distribution.test.ts`

- [ ] **Step 1:** 100 unique senders, ROUND_ROBIN strategy, 5 active agents
- [ ] **Step 2:** Assert per-agent assignment count is within ±15% of 20 (i.e., 17–23 per agent)
- [ ] **Step 3:** Repeat with LOAD_BALANCED, assert variance ≤ ±10%
- [ ] **Commit:** `test(6a/load): distribution evenness under burst`

---

## Phase 15: Pipeline wiring + flag rollout

### Task 56: Wire pipeline.ts to all webhook entry points

**Spec ref:** §10

**Files:**
- Modify: all three webhook route files from Tasks 32-34

- [ ] **Step 1:** Inside each route, build `IntakePayload` from request body, call `runPipeline(payload, stages)` where `stages` is the assembled `{ spam, normalize, dedup, department, tour, assignment, dispatch }` object
- [ ] **Step 2:** Gate behind `isIntakePipelineV2Enabled(tenantId)`; if disabled, fall through to existing intake logic (for backward compat during rollout)
- [ ] **Step 3:** Commit: `feat(6a): wire runPipeline behind INTAKE_PIPELINE_V2_ENABLED flag`

### Task 57: Smoke test + flag enable in local dev

**Files:** none (operational)

- [ ] **Step 1:** Set `INTAKE_PIPELINE_V2_ENABLED=*` in local `.env`
- [ ] **Step 2:** Trigger one webhook per source via curl, verify Lead created, conversation visible, no errors in logs
- [ ] **Step 3:** Run full test suite: `npm test && npx playwright test`
- [ ] **Step 4:** Production rollout via [[vps-deploy]] skill:
  - Backup VPS
  - Push to master
  - SSH to gmc-vps, run `docker compose -f docker-compose.yml -f docker-compose.prod.yml pull && up -d`
  - Run `docker exec app-app-1 npx prisma migrate deploy`
  - Set `INTAKE_PIPELINE_V2_ENABLED=<tenantId-of-Holiday-Delight>` in `/opt/vacaycrm/app/.env`
  - Restart app container
  - Smoke-test on production with a test form submission
- [ ] **Step 5:** Update memory `project_holiday_delight_crm.md` with deploy timestamp + commit hash
- [ ] **Commit:** `chore(6a): rollout — flag enabled for Holiday Delight tenant on prod`

---

## Done definition

- All 57 task checkboxes ticked
- All unit + integration + E2E tests green on CI
- Load tests pass within stated tolerances
- Spec §1 hard rules verified (no dead features, every UI button → real API)
- All RBAC checks present on every write endpoint
- Tenant-scoping verified on every read (manual audit of `where:` clauses)
- Feature flag enabled for Holiday Delight tenant in production
- Spec, plan, and project memory updated with final commit hashes

## References

- Spec: `docs/superpowers/specs/2026-05-25-phase-6a-design.md`
- Project memory: `~/.claude/projects/C--Users-Sathyamoorthy-V/memory/project_holiday_delight_crm.md`
- Prior plan style: `docs/superpowers/plans/2026-05-22-holiday-delight-crm-phases2-5.md`
- VPS deploy protocol: `vps-deploy` skill
