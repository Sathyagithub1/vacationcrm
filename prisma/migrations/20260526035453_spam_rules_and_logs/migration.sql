-- CreateEnum
CREATE TYPE "SpamRuleType" AS ENUM ('BLACKLIST', 'RATE_LIMIT', 'PATTERN', 'AI');

-- CreateEnum
CREATE TYPE "SpamAction" AS ENUM ('BLOCKED');

-- CreateTable
CREATE TABLE "spam_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "SpamRuleType" NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "department_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identifier" TEXT NOT NULL,
    "reason" TEXT,
    "threshold" INTEGER,
    "window_seconds" INTEGER,
    "block_seconds" INTEGER,
    "ai_threshold" DOUBLE PRECISION,
    "created_by_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender_identifier" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "matched_rule_id" TEXT,
    "action" "SpamAction" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spam_rules_tenant_id_is_active_idx" ON "spam_rules"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "spam_rules_tenant_id_type_identifier_idx" ON "spam_rules"("tenant_id", "type", "identifier");

-- CreateIndex
CREATE INDEX "spam_logs_tenant_id_occurred_at_idx" ON "spam_logs"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "spam_rules" ADD CONSTRAINT "spam_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_rules" ADD CONSTRAINT "spam_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_logs" ADD CONSTRAINT "spam_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
