-- Migration: tenant_google_forms_key
-- Adds googleFormsKey (optional, unique) to the tenants table.
-- Used by the Google Forms intake webhook (T34) to store the per-tenant
-- HMAC signing key that Apps Script POSTs the X-Signature header with.

ALTER TABLE "tenants" ADD COLUMN "google_forms_key" TEXT;
CREATE UNIQUE INDEX "tenants_google_forms_key_key" ON "tenants"("google_forms_key");
