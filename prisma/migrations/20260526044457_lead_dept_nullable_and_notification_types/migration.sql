-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ASSIGNMENT_FALLBACK';
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_FORM_PENDING_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_FORM_KEY_DIFF';

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_department_id_fkey";

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "department_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
