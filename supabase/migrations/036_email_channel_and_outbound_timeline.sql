-- Migration 036: Email as a first-class send channel + outbound-message timeline.
--
-- All changes are additive and idempotent. Safe to re-run on a live database.
-- Applied MANUALLY via the Supabase SQL editor (do NOT `supabase db push`).
--
-- Background
-- ----------
-- B3 ships two related features:
--   #56  Email delivery for intake / upload / appointment links (reuses the
--        Resend send path). The link routes now record sent_channel = 'email'
--        on the corresponding token when an email send succeeds.
--   #57  Outbound messages (Viber / SMS / email) are logged to the existing
--        `communications` table so they appear in the customer timeline, and
--        the Apifon status webhook propagates delivery/seen/failed status onto
--        the linked communications row.
--
-- This migration only widens two CHECK constraints so the token rows can store
-- 'email'. Everything else (communications insert, viber_messages insert,
-- status propagation) uses columns that already exist:
--   * communications  (003_crm_core.sql) already allows channel
--       IN ('call','sms','viber','email') and status
--       IN ('started','sent','delivered','seen','failed','completed').
--   * viber_messages   (006_viber_messages.sql) already has communication_id,
--       provider_request_id, provider_message_id, reference_id, status, etc.
-- so NO schema change is required for the timeline itself — only the two
-- token tables below need 'email' added to their sent_channel domain.
--
-- The application is written to degrade gracefully if this migration has not
-- been applied yet: the token "mark sent" updates are best-effort/swallowed, so
-- email still sends and still appears in the timeline even before 036 runs.
-- This migration simply makes the token's recorded channel accurate.

-- ---------------------------------------------------------------------------
-- 1. customer_intake_tokens.sent_channel  → allow 'email'
-- ---------------------------------------------------------------------------
-- Drop ANY existing CHECK constraint that references sent_channel (its name may
-- differ across environments), then add a single permissive, NULL-safe one.

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.customer_intake_tokens'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%sent_channel%'
  LOOP
    EXECUTE 'ALTER TABLE public.customer_intake_tokens DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE public.customer_intake_tokens
  ADD CONSTRAINT customer_intake_tokens_sent_channel_check
  CHECK (sent_channel IS NULL OR sent_channel IN ('viber', 'sms', 'email', 'manual'));

-- ---------------------------------------------------------------------------
-- 2. customer_upload_tokens.sent_channel  → allow 'email'
-- ---------------------------------------------------------------------------

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.customer_upload_tokens'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%sent_channel%'
  LOOP
    EXECUTE 'ALTER TABLE public.customer_upload_tokens DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END $$;

ALTER TABLE public.customer_upload_tokens
  ADD CONSTRAINT customer_upload_tokens_sent_channel_check
  CHECK (sent_channel IS NULL OR sent_channel IN ('viber', 'sms', 'email', 'manual'));

-- appointment_response_tokens.sent_channel already includes 'email'
-- (see 0xx_appointment_response_tokens.sql) — no change needed there.
