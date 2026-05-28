-- Phase 6d: Voice + IVR
-- Migration: 20260527300000_phase_6d_voice_ivr
--
-- 1. Add voice/IVR enums: CallDirection, VoiceCallStatus, VoiceSegmentSpeaker
-- 2. Create voice_calls table
-- 3. Create voice_call_segments table
-- 4. Add telephony + STT/TTS columns to tenants

-- ── 1. Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "VoiceCallStatus" AS ENUM (
    'RINGING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'MISSED',
    'VOICEMAIL'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "VoiceSegmentSpeaker" AS ENUM ('CUSTOMER', 'BOT', 'AGENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── 2. voice_calls table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "voice_calls" (
  "id"                  TEXT            NOT NULL,
  "tenant_id"           TEXT            NOT NULL,
  "customer_id"         TEXT,
  "lead_id"             TEXT,
  "conversation_id"     TEXT,
  "channel_config_id"   TEXT,
  "direction"           "CallDirection" NOT NULL,
  "from_number"         TEXT            NOT NULL,
  "to_number"           TEXT            NOT NULL,
  "provider_call_sid"   TEXT            NOT NULL,
  "status"              "VoiceCallStatus" NOT NULL DEFAULT 'RINGING',
  "started_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answered_at"         TIMESTAMP(3),
  "ended_at"            TIMESTAMP(3),
  "duration_seconds"    INTEGER,
  "recording_url"       TEXT,
  "transcript_url"      TEXT,
  "language"            TEXT,
  "intent"              TEXT,
  "notes"               JSONB,

  CONSTRAINT "voice_calls_pkey"                 PRIMARY KEY ("id"),
  CONSTRAINT "voice_calls_provider_call_sid_key" UNIQUE ("provider_call_sid"),

  CONSTRAINT "voice_calls_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "voice_calls_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
  CONSTRAINT "voice_calls_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id"),
  CONSTRAINT "voice_calls_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id"),
  CONSTRAINT "voice_calls_channel_config_id_fkey"
    FOREIGN KEY ("channel_config_id") REFERENCES "channel_configs"("id")
);

CREATE INDEX IF NOT EXISTS "voice_calls_tenant_id_idx"
  ON "voice_calls"("tenant_id");

CREATE INDEX IF NOT EXISTS "voice_calls_tenant_id_status_idx"
  ON "voice_calls"("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "voice_calls_tenant_id_started_at_idx"
  ON "voice_calls"("tenant_id", "started_at");

-- ── 3. voice_call_segments table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "voice_call_segments" (
  "id"            TEXT                    NOT NULL,
  "voice_call_id" TEXT                    NOT NULL,
  "speaker"       "VoiceSegmentSpeaker"   NOT NULL,
  "content"       TEXT                    NOT NULL,
  "audio_url"     TEXT,
  "start_ms"      INTEGER                 NOT NULL,
  "end_ms"        INTEGER,
  "created_at"    TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_call_segments_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "voice_call_segments_voice_call_id_fkey"
    FOREIGN KEY ("voice_call_id") REFERENCES "voice_calls"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "voice_call_segments_voice_call_id_idx"
  ON "voice_call_segments"("voice_call_id");

-- ── 4. Telephony + STT/TTS columns on tenants ─────────────────────────────────

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "telephony_provider"         TEXT,
  ADD COLUMN IF NOT EXISTS "telephony_api_key"          TEXT,
  ADD COLUMN IF NOT EXISTS "telephony_api_secret"       TEXT,
  ADD COLUMN IF NOT EXISTS "telephony_phone_number"     TEXT,
  ADD COLUMN IF NOT EXISTS "stt_provider"               TEXT,
  ADD COLUMN IF NOT EXISTS "stt_api_key"                TEXT,
  ADD COLUMN IF NOT EXISTS "tts_provider"               TEXT,
  ADD COLUMN IF NOT EXISTS "tts_api_key"                TEXT,
  ADD COLUMN IF NOT EXISTS "voice_agent_enabled"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "voice_agent_languages"      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "voice_agent_system_prompt"  TEXT;
