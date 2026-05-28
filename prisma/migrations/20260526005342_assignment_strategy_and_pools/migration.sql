-- CreateEnum
CREATE TYPE "AssignmentStrategyType" AS ENUM ('ROUND_ROBIN', 'LOAD_BALANCED', 'SKILL_BASED', 'AI_TIERED', 'NAMED_POOLS');

-- CreateTable
CREATE TABLE "assignment_strategies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "AssignmentStrategyType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_pools" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agent_ids" TEXT[],
    "source_match" JSONB NOT NULL DEFAULT '[]',
    "department_id" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_cursors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "last_agent_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_strategies_tenant_id_key" ON "assignment_strategies"("tenant_id");

-- CreateIndex
CREATE INDEX "assignment_pools_tenant_id_is_active_priority_idx" ON "assignment_pools"("tenant_id", "is_active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_cursors_tenant_id_scope_key" ON "assignment_cursors"("tenant_id", "scope");

-- AddForeignKey
ALTER TABLE "assignment_strategies" ADD CONSTRAINT "assignment_strategies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pools" ADD CONSTRAINT "assignment_pools_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_pools" ADD CONSTRAINT "assignment_pools_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
