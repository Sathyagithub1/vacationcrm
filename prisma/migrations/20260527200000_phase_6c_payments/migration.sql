-- Phase 6c: Razorpay Payments
-- Migration: 20260527200000_phase_6c_payments
--
-- 1. Add PaymentStatus enum (PG < 17 compatible — idempotent CREATE)
-- 2. Create payments table
-- 3. Add razorpay columns to tenants

-- ── 1. PaymentStatus enum ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM (
    'CREATED',
    'AUTHORIZED',
    'CAPTURED',
    'FAILED',
    'REFUND_PENDING',
    'REFUNDED'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── 2. payments table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payments" (
  "id"                    TEXT        NOT NULL,
  "tenant_id"             TEXT        NOT NULL,
  "lead_id"               TEXT,
  "customer_id"           TEXT        NOT NULL,
  "tour_id"               TEXT,
  "seats"                 INTEGER     NOT NULL DEFAULT 1,
  "amount_paise"          INTEGER     NOT NULL,
  "currency"              TEXT        NOT NULL DEFAULT 'INR',
  "razorpay_order_id"     TEXT        NOT NULL,
  "razorpay_payment_id"   TEXT,
  "status"                "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "notes"                 JSONB,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_at"               TIMESTAMP(3),
  "refunded_at"           TIMESTAMP(3),
  "error_message"         TEXT,
  "booking_id"            TEXT,

  CONSTRAINT "payments_pkey"                    PRIMARY KEY ("id"),
  CONSTRAINT "payments_razorpay_order_id_key"   UNIQUE ("razorpay_order_id"),
  CONSTRAINT "payments_razorpay_payment_id_key" UNIQUE ("razorpay_payment_id"),

  CONSTRAINT "payments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id")  REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "payments_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
  CONSTRAINT "payments_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id"),
  CONSTRAINT "payments_tour_id_fkey"
    FOREIGN KEY ("tour_id") REFERENCES "tours"("id"),
  CONSTRAINT "payments_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "tour_bookings"("id")
);

CREATE INDEX IF NOT EXISTS "payments_tenant_id_idx"
  ON "payments"("tenant_id");

CREATE INDEX IF NOT EXISTS "payments_tenant_id_status_idx"
  ON "payments"("tenant_id", "status");

-- ── 3. Razorpay credential columns on tenants ─────────────────────────────────
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "razorpay_key_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "razorpay_key_secret"       TEXT,
  ADD COLUMN IF NOT EXISTS "razorpay_webhook_secret"   TEXT;
