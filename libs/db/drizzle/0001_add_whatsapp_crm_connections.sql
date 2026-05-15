-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 0001_add_whatsapp_crm_connections
-- Purpose:   CRM WhatsApp Connection — OTP-verified phone linking per user
-- Surface:   CRM (Premium only)
-- Industries: All 8
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "whatsapp_crm_connections" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL,
  "phone"           text NOT NULL,
  "otp_code_hash"   text,
  "otp_expires_at"  timestamptz,
  "otp_attempts"    integer NOT NULL DEFAULT 0,
  "verified"        boolean NOT NULL DEFAULT false,
  "connected_at"    timestamptz,
  "last_message_at" timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_wa_crm_user_id" ON "whatsapp_crm_connections" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_wa_crm_phone"   ON "whatsapp_crm_connections" ("phone");
