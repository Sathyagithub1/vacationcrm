-- Migration: multitenant_saas
-- ADDITIVE ONLY — safe on the live single-tenant production DB.
--
-- Adds an optional `plan` column to the tenants table for the multi-tenant SaaS
-- capability (public signup + per-tenant quotas + billing scaffold).
--
--   NULL plan  → no plan set → treated as free/unlimited, NO enforcement.
--                This is the state of the existing live tenant, so behavior is
--                identical to today until an operator explicitly sets a plan.
--
-- This migration does NOT drop, alter-destructive, or delete any data. It only
-- appends a nullable column with no default value, so every existing row keeps
-- plan = NULL (= unlimited/free).

ALTER TABLE "tenants" ADD COLUMN "plan" TEXT;
