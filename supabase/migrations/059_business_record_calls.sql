-- Migration 059: businesses.record_calls
--
-- Per-business "record calls" preference. When FALSE, the outbound TwiML webhook
-- (src/app/api/webhooks/voice/twilio/outbound/route.ts) skips Twilio recording
-- AND the downstream Deepgram/OpenAI brief pipeline for that business — a COGS
-- control and a consent/GDPR control (a user who turns recording OFF must not be
-- recorded, transcribed or billed).
--
-- Applied MANUALLY via the Supabase SQL editor. Additive + idempotent. Safe to re-run.
--
-- Default TRUE preserves today's behaviour (recording auto-on). App code is
-- TOLERANT of this column being absent (the /api/phone/recording route degrades
-- to "enabled", and the webhook defaults to recording), so this is safe to ship
-- before the SQL lands.
--
-- No RLS change: the businesses UPDATE policy (migration 022) already covers it,
-- and all writes go through the service-role / authenticated server routes.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS record_calls boolean NOT NULL DEFAULT true;
