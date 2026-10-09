-- Reconcile the migrated database with prisma/schema.prisma.
--
-- Generated from `prisma migrate diff --from-url <db migrated from 0_init..HEAD>
-- --to-schema-datamodel prisma/schema.prisma`, then made re-runnable with IF EXISTS.
--
-- Data safety: this migration deletes NO rows and drops NO columns or tables.
--   * It drops one UNIQUE index, which only relaxes a constraint.
--   * It re-creates foreign keys with the referential actions declared in
--     schema.prisma (ON UPDATE CASCADE, and ON DELETE SET NULL where the
--     relation is optional). Every existing row already satisfies these FKs,
--     because the same FKs exist today with stricter or equal semantics.
--   * It drops column DEFAULTs that schema.prisma does not declare. Prisma
--     generates these values client-side (@default(uuid()), @updatedAt), and
--     no raw SQL in the repo inserts into these tables.

-- 1) Multi-number channels.
-- 0_init created "channel_configs_tenant_id_channel_key" as a UNIQUE INDEX.
-- Migration 20260527100000 tried to remove it with DROP CONSTRAINT IF EXISTS,
-- which is a silent no-op for a plain index, so a tenant still could not add a
-- second WhatsApp number. The intended key is
-- (tenant_id, channel, external_id), which that migration already created.
DROP INDEX IF EXISTS "channel_configs_tenant_id_channel_key";

-- 2) Foreign keys: align referential actions with schema.prisma.
ALTER TABLE "channel_configs" DROP CONSTRAINT IF EXISTS "channel_configs_assigned_department_id_fkey";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_channel_config_id_fkey";
ALTER TABLE "customer_memories" DROP CONSTRAINT IF EXISTS "customer_memories_customer_id_fkey";
ALTER TABLE "customer_memories" DROP CONSTRAINT IF EXISTS "customer_memories_tenant_id_fkey";
ALTER TABLE "escalation_rules" DROP CONSTRAINT IF EXISTS "escalation_rules_tenant_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_booking_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_customer_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_lead_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_tenant_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_tour_id_fkey";
ALTER TABLE "voice_call_segments" DROP CONSTRAINT IF EXISTS "voice_call_segments_voice_call_id_fkey";
ALTER TABLE "voice_calls" DROP CONSTRAINT IF EXISTS "voice_calls_channel_config_id_fkey";
ALTER TABLE "voice_calls" DROP CONSTRAINT IF EXISTS "voice_calls_conversation_id_fkey";
ALTER TABLE "voice_calls" DROP CONSTRAINT IF EXISTS "voice_calls_customer_id_fkey";
ALTER TABLE "voice_calls" DROP CONSTRAINT IF EXISTS "voice_calls_lead_id_fkey";
ALTER TABLE "voice_calls" DROP CONSTRAINT IF EXISTS "voice_calls_tenant_id_fkey";

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_config_id_fkey" FOREIGN KEY ("channel_config_id") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_assigned_department_id_fkey" FOREIGN KEY ("assigned_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "tour_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_memories" ADD CONSTRAINT "customer_memories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_memories" ADD CONSTRAINT "customer_memories_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_channel_config_id_fkey" FOREIGN KEY ("channel_config_id") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voice_call_segments" ADD CONSTRAINT "voice_call_segments_voice_call_id_fkey" FOREIGN KEY ("voice_call_id") REFERENCES "voice_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Column defaults that schema.prisma does not declare.
ALTER TABLE "customer_memories" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "escalation_rules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "config" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "updated_at" DROP DEFAULT;
