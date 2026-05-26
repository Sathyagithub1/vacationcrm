-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadActivityType" ADD VALUE 'REPEAT_INQUIRY';
ALTER TYPE "LeadActivityType" ADD VALUE 'ASSIGNED';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "intake_form_id" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "tour_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assignment_tier" INTEGER,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "on_leave_until" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_intake_form_id_fkey" FOREIGN KEY ("intake_form_id") REFERENCES "intake_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes for dedup race protection (Phase 6a §4.1)
-- Note: customers table uses `mobile` (NOT NULL) — already enforced by existing unique(tenant_id, mobile).
-- Only email needs a partial unique (email is nullable).
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_unique
  ON customers (tenant_id, email) WHERE email IS NOT NULL;
