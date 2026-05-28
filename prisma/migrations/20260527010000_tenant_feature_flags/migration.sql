-- Migration: tenant_feature_flags
-- Adds featureFlags (Json, default '{}') to the tenants table.
-- Used by the per-tenant pipeline v2 flag check (T56):
--   tenant.featureFlags.INTAKE_PIPELINE_V2_ENABLED === true  → pipeline enabled
--   absent key (default '{}') → treated as enabled (opt-out model, backwards-compatible)

ALTER TABLE "tenants" ADD COLUMN "feature_flags" JSONB NOT NULL DEFAULT '{}';
