-- Migration 031: Per-user SIP provisioning + telephony onboarding mode + presence.
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- DROP POLICY IF EXISTS). No drops or renames. Safe to re-run.
--
-- Context: the browser phone currently authenticates every user with a single
-- shared SIP account from env (PHONE_SIP_*). This migration gives each business
-- its OWN browser SIP credential and adds the multi-user telephony scaffolding:
--   1) browser_sip_endpoints.sip_password_enc — per-business SIP password,
--      AES-256-GCM encrypted by the app (env SIP_CRED_ENC_KEY). The DB never
--      stores plaintext. The matching credential reaches Asterisk via the sync
--      described in docs/ASTERISK_REALTIME_PROVISIONING.md.
--   2) businesses.telephony_mode — the A/B onboarding model for the user's
--      existing number ('forward' = keep own number + divert; 'native' = use
--      the assigned Opiflow number only).
--   3) business_user_presence — per-user availability used by call routing
--      (ring the app vs. send to AI intake / voicemail).
--
-- The app reads all of these DEFENSIVELY: if this migration has not yet been
-- applied, the relevant endpoints degrade gracefully and the existing shared-env
-- phone path keeps working unchanged.

-- ---------------------------------------------------------------------------
-- 1) Per-user SIP credential storage
-- ---------------------------------------------------------------------------
ALTER TABLE public.browser_sip_endpoints
  ADD COLUMN IF NOT EXISTS sip_password_enc    text,
  ADD COLUMN IF NOT EXISTS sip_password_set_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Telephony onboarding model on the business
--    'native'  = Model B: use the assigned Opiflow number only.
--    'forward' = Model A: keep own number, forward (divert) it to the Opiflow number.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS telephony_mode           text,
  ADD COLUMN IF NOT EXISTS forwarding_source_number text;

DO $$
BEGIN
  ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_telephony_mode_check
    CHECK (telephony_mode IS NULL OR telephony_mode IN ('native', 'forward'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Per-user presence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_user_presence (
  user_id     uuid        NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  business_id uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'available',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id),
  CONSTRAINT business_user_presence_status_check
    CHECK (status IN ('available', 'busy', 'away', 'offline', 'dnd'))
);

CREATE INDEX IF NOT EXISTS business_user_presence_business_id_idx
  ON public.business_user_presence (business_id);

ALTER TABLE public.business_user_presence ENABLE ROW LEVEL SECURITY;

-- Users may read their own presence row; all writes go through the backend
-- (service_role), so no authenticated INSERT/UPDATE policy is granted.
DROP POLICY IF EXISTS "business_user_presence_select_own" ON public.business_user_presence;
CREATE POLICY "business_user_presence_select_own"
  ON public.business_user_presence
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL PRIVILEGES ON TABLE public.business_user_presence FROM anon;
GRANT SELECT                         ON TABLE public.business_user_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_user_presence TO service_role;
