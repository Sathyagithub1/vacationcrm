-- Migration: 6b multi-channel configs, customer memory, escalation rules
-- Phase 6b: Multiple WhatsApp numbers + tags + broadcast + memory + escalation

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.1: ChannelConfig — drop old unique, add new fields, add new unique
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Drop the old unique constraint on (tenant_id, channel)
ALTER TABLE "channel_configs" DROP CONSTRAINT IF EXISTS "channel_configs_tenant_id_channel_key";

-- Step 2: Add new columns
ALTER TABLE "channel_configs"
  ADD COLUMN IF NOT EXISTS "label"                   TEXT,
  ADD COLUMN IF NOT EXISTS "external_id"             TEXT,
  ADD COLUMN IF NOT EXISTS "assigned_department_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "is_primary"              BOOLEAN NOT NULL DEFAULT false;

-- Step 3: Add foreign key for assigned_department_id
ALTER TABLE "channel_configs"
  ADD CONSTRAINT "channel_configs_assigned_department_id_fkey"
    FOREIGN KEY ("assigned_department_id")
    REFERENCES "departments"("id")
    ON DELETE SET NULL;

-- Step 4: Add new unique constraint on (tenant_id, channel, external_id)
-- Note: existing rows with NULL external_id will get a NULL in the unique which
--       PostgreSQL treats as distinct, so multiple NULLs are allowed.
ALTER TABLE "channel_configs"
  ADD CONSTRAINT "channel_configs_tenant_id_channel_external_id_key"
    UNIQUE ("tenant_id", "channel", "external_id");

-- Step 5: Add secondary index for (tenant_id, channel) for fast lookups
CREATE INDEX IF NOT EXISTS "channel_configs_tenant_id_channel_idx"
  ON "channel_configs"("tenant_id", "channel");

-- Down (reversible):
-- ALTER TABLE "channel_configs" DROP CONSTRAINT "channel_configs_tenant_id_channel_external_id_key";
-- DROP INDEX IF EXISTS "channel_configs_tenant_id_channel_idx";
-- ALTER TABLE "channel_configs" DROP CONSTRAINT IF EXISTS "channel_configs_assigned_department_id_fkey";
-- ALTER TABLE "channel_configs" DROP COLUMN IF EXISTS "label", DROP COLUMN IF EXISTS "external_id", DROP COLUMN IF EXISTS "assigned_department_id", DROP COLUMN IF EXISTS "is_primary";
-- ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_tenant_id_channel_key" UNIQUE ("tenant_id", "channel");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.1: Conversation — add channelConfigId, summary, escalatedAt, escalationReason
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "channel_config_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "summary"            TEXT,
  ADD COLUMN IF NOT EXISTS "escalated_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "escalation_reason"  TEXT;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_config_id_fkey"
    FOREIGN KEY ("channel_config_id")
    REFERENCES "channel_configs"("id")
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "conversations_tenant_id_customer_id_idx"
  ON "conversations"("tenant_id", "customer_id");

-- Down:
-- ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_channel_config_id_fkey";
-- ALTER TABLE "conversations" DROP COLUMN IF EXISTS "channel_config_id", DROP COLUMN IF EXISTS "summary", DROP COLUMN IF EXISTS "escalated_at", DROP COLUMN IF EXISTS "escalation_reason";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.2: Customer — add tag_ids
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "tag_ids" TEXT[] NOT NULL DEFAULT '{}';

-- Down:
-- ALTER TABLE "customers" DROP COLUMN IF EXISTS "tag_ids";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.2: Broadcast — add target_tag_ids
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "broadcasts"
  ADD COLUMN IF NOT EXISTS "target_tag_ids" TEXT[] NOT NULL DEFAULT '{}';

-- Down:
-- ALTER TABLE "broadcasts" DROP COLUMN IF EXISTS "target_tag_ids";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.3: CustomerMemory — new table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE IF NOT EXISTS "CustomerMemoryKind" AS ENUM ('FACT', 'PREFERENCE', 'SUMMARY');

CREATE TABLE IF NOT EXISTS "customer_memories" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"        TEXT NOT NULL,
  "customer_id"      TEXT NOT NULL,
  "kind"             "CustomerMemoryKind" NOT NULL,
  "content"          TEXT NOT NULL,
  "source_message_id" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customer_memories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_memories_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "customer_memories_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
  CONSTRAINT "customer_memories_tenant_id_customer_id_kind_content_key"
    UNIQUE ("tenant_id", "customer_id", "kind", "content")
);

CREATE INDEX IF NOT EXISTS "customer_memories_tenant_id_customer_id_idx"
  ON "customer_memories"("tenant_id", "customer_id");

-- Down:
-- DROP TABLE IF EXISTS "customer_memories";
-- DROP TYPE IF EXISTS "CustomerMemoryKind";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b.4: EscalationRule — new table + enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE IF NOT EXISTS "EscalationRuleType" AS ENUM (
  'MESSAGE_COUNT_THRESHOLD', 'DURATION', 'AI_INTENT'
);

CREATE TYPE IF NOT EXISTS "EscalationRuleAction" AS ENUM ('ESCALATE', 'PARK', 'NOTIFY');

CREATE TABLE IF NOT EXISTS "escalation_rules" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "type"       "EscalationRuleType" NOT NULL,
  "config"     JSONB NOT NULL DEFAULT '{}',
  "action"     "EscalationRuleAction" NOT NULL,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "escalation_rules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "escalation_rules_tenant_id_is_active_idx"
  ON "escalation_rules"("tenant_id", "is_active");

-- Down:
-- DROP TABLE IF EXISTS "escalation_rules";
-- DROP TYPE IF EXISTS "EscalationRuleAction";
-- DROP TYPE IF EXISTS "EscalationRuleType";
