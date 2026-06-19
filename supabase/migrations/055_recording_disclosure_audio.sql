-- Migration 055: businesses.recording_disclosure_audio
--
-- Per-business call-recording DISCLOSURE clip, recorded by the user in their own
-- voice during onboarding / settings. Stored INLINE as a base64 data: URL (same
-- approach as logo_url) — short clip, no Storage bucket needed.
--
-- Applied MANUALLY via the Supabase SQL editor. Additive + idempotent. Safe to re-run.
--
-- The PBX provisioner (scripts/provision-asterisk.py) reads this column, decodes it,
-- transcodes to 8 kHz mono PCM WAV per business, and the dialplan plays it (via an
-- OPIFLOW_DISCLOSURE channel var) BEFORE bridging — falling back to the global
-- opiflow-call-recorded clip when a business has not recorded one. App code is
-- TOLERANT of this column being absent (the /api/businesses/me/disclosure-audio
-- route degrades to "not configured"), so this is safe to ship before the SQL lands.
--
-- No RLS change: the businesses UPDATE policy (migration 022) already covers it,
-- and all writes go through the service-role server route.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS recording_disclosure_audio text;
