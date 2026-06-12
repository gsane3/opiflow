-- Migration 043: Product-readiness review fixes (sessions 16 — R3/R4/R6).
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Idempotent: constraint swaps use DROP IF EXISTS + ADD, columns/indexes use
-- IF NOT EXISTS, functions use CREATE OR REPLACE.
--
-- Contents:
--   1. communications.status: allow 'missed' (the missed-call funnel writes it;
--      web/native already render it — the constraint was the only blocker).
--   2. provider_webhook_events.provider: allow 'twilio' (recording reconcile
--      queue for the brief pipeline).
--   3. Atomic per-business counters for crm_number / offer_number — replaces
--      the O(n) fetch-all-and-Math.max scan and closes the duplicate-number
--      race. Backfilled from the current maxima.
--   4. Indexes: communications(provider_call_id) for the recording webhook's
--      lookup (038's index leads with business_id, which that lookup lacks),
--      and (business_id, responded_at DESC) on the two response-token tables
--      used by the notifications bell on every dashboard render.

-- 1. communications.status += 'missed' ---------------------------------------
ALTER TABLE public.communications
  DROP CONSTRAINT IF EXISTS communications_status_check;

ALTER TABLE public.communications
  ADD CONSTRAINT communications_status_check
    CHECK (status IN ('started', 'sent', 'delivered', 'seen', 'failed', 'completed', 'missed'));

-- 2. provider_webhook_events.provider += 'twilio' -----------------------------
ALTER TABLE public.provider_webhook_events
  DROP CONSTRAINT IF EXISTS provider_webhook_events_provider_check;

ALTER TABLE public.provider_webhook_events
  ADD CONSTRAINT provider_webhook_events_provider_check
    CHECK (provider IN ('apifon', 'telnyx', 'pbx', 'twilio'));

-- 3. Atomic counters ----------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS next_crm_number integer,
  ADD COLUMN IF NOT EXISTS next_offer_number integer;

-- Backfill from the current maxima (same trailing-digits rule the app used).
UPDATE public.businesses b
   SET next_crm_number = COALESCE(
     (SELECT MAX((substring(c.crm_number FROM '(\d+)\s*$'))::int) + 1
        FROM public.customers c
       WHERE c.business_id = b.id
         AND c.crm_number ~ '\d+\s*$'),
     1)
 WHERE b.next_crm_number IS NULL;

UPDATE public.businesses b
   SET next_offer_number = COALESCE(
     (SELECT MAX((substring(o.offer_number FROM '(\d+)\s*$'))::int) + 1
        FROM public.offers o
       WHERE o.business_id = b.id
         AND o.offer_number ~ '\d+\s*$'),
     1)
 WHERE b.next_offer_number IS NULL;

-- Atomic take-a-number. UPDATE ... RETURNING is atomic per row, so two
-- concurrent calls can never mint the same number.
CREATE OR REPLACE FUNCTION public.take_next_crm_number(p_business_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.businesses
     SET next_crm_number = COALESCE(next_crm_number, 1) + 1
   WHERE id = p_business_id
   RETURNING next_crm_number - 1;
$$;

CREATE OR REPLACE FUNCTION public.take_next_offer_number(p_business_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.businesses
     SET next_offer_number = COALESCE(next_offer_number, 1) + 1
   WHERE id = p_business_id
   RETURNING next_offer_number - 1;
$$;

-- Service-role only (the API routes call these; clients never do).
REVOKE ALL ON FUNCTION public.take_next_crm_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.take_next_crm_number(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.take_next_crm_number(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.take_next_crm_number(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.take_next_offer_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.take_next_offer_number(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.take_next_offer_number(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.take_next_offer_number(uuid) TO service_role;

-- 4. Indexes -------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS communications_provider_call_idx
  ON public.communications (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS offer_response_tokens_business_responded_idx
  ON public.offer_response_tokens (business_id, responded_at DESC);

CREATE INDEX IF NOT EXISTS appointment_response_tokens_business_responded_idx
  ON public.appointment_response_tokens (business_id, responded_at DESC);
