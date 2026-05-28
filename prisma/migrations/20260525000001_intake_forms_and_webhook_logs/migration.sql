-- CreateEnum
CREATE TYPE "IntakeFormStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'PAUSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSource" ADD VALUE 'META_LEAD_AD';
ALTER TYPE "LeadSource" ADD VALUE 'GOOGLE_FORMS';
ALTER TYPE "LeadSource" ADD VALUE 'WEBSITE_SNIPPET';
ALTER TYPE "LeadSource" ADD VALUE 'FORM_BUILDER';
ALTER TYPE "LeadSource" ADD VALUE 'EMAIL';
ALTER TYPE "LeadSource" ADD VALUE 'MESSENGER';
ALTER TYPE "LeadSource" ADD VALUE 'TELEGRAM';

-- AlterTable: add intake_token as nullable, backfill, then enforce NOT NULL
ALTER TABLE "tenants" ADD COLUMN     "intake_token" TEXT;

-- Backfill existing rows with unique tokens (cuid()-style generated server-side)
UPDATE "tenants" SET "intake_token" = 'tk_' || replace(gen_random_uuid()::text, '-', '') WHERE "intake_token" IS NULL;

-- Enforce NOT NULL after backfill (new rows use Prisma cuid() default)
ALTER TABLE "tenants" ALTER COLUMN "intake_token" SET NOT NULL;

-- CreateTable
CREATE TABLE "intake_forms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" TEXT,
    "default_tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldMap" JSONB NOT NULL,
    "field_mapping_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "IntakeFormStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_webhook_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "source" "LeadSource",
    "endpoint" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "lead_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_forms_tenant_id_status_idx" ON "intake_forms"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_tenant_id_source_external_id_key" ON "intake_forms"("tenant_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "intake_webhook_logs_tenant_id_received_at_idx" ON "intake_webhook_logs"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_intake_token_key" ON "tenants"("intake_token");

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

