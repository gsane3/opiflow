-- Migration 038: Brief timeline (append, not overwrite) + reliable call matching.
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Additive + idempotent. Safe to re-run.
--
-- PROBLEM this fixes:
--  (a) Today exactly ONE brief lives in communications.summary, and the recording
--      pipeline OVERWRITES it (metadata brief -> transcript brief). Per-call history
--      is lost, so a customer's "journey across calls" cannot be shown.
--  (b) The Twilio RecordingStatusCallback matches the call by a fragile
--      LIKE '%twilio_sid=<CallSid>%' scan of communications.summary, which is never
--      stamped -> recordings silently fail to attach (briefs dropped).
--
-- FIX: a dedicated append-only public.call_briefs table (one row per brief, kept
-- forever) + communications.provider_call_id for exact matching + a synthesized
-- cross-call narrative on customers (journey_summary, written review-first).

-- 1. call_briefs (append-only; one row per brief) -----------------------------
CREATE TABLE IF NOT EXISTS public.call_briefs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id      uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  communication_id uuid        REFERENCES public.communications(id) ON DELETE CASCADE,
  brief_kind       text        NOT NULL,
  brief_text       text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_briefs_kind_check CHECK (brief_kind IN ('metadata', 'transcript'))
);

CREATE INDEX IF NOT EXISTS call_briefs_business_customer_idx
  ON public.call_briefs (business_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS call_briefs_communication_idx
  ON public.call_briefs (communication_id);

-- 2. communications.provider_call_id (exact Twilio/PBX call-id match) ----------
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS provider_call_id text;

CREATE INDEX IF NOT EXISTS communications_business_provider_call_idx
  ON public.communications (business_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

-- 3. customers: AI-synthesized cross-call narrative (review-first) -------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS journey_summary     text,
  ADD COLUMN IF NOT EXISTS journey_updated_at  timestamptz;

-- 4. RLS (mirror the customers/tasks membership pattern from 003_crm_core) -----
ALTER TABLE public.call_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_briefs_select_business_members" ON public.call_briefs;
CREATE POLICY "call_briefs_select_business_members"
  ON public.call_briefs FOR SELECT TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "call_briefs_insert_business_members" ON public.call_briefs;
CREATE POLICY "call_briefs_insert_business_members"
  ON public.call_briefs FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

-- 5. Grants -------------------------------------------------------------------
GRANT SELECT, INSERT ON public.call_briefs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_briefs TO service_role;
