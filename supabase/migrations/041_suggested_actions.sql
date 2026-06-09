-- Migration 041: AI suggested-action chips (persisted, per customer).
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Additive + idempotent. Safe to re-run.
--
-- The redesign shows AI-proposed next actions as tappable chips inside the
-- customer chat (e.g. after a call: "Δημιουργία προσφοράς"). Today the "next
-- action" lives only as free-text inside communications.summary and the /api/ai
-- intents are ephemeral. This table persists those suggestions so they can be
-- rendered, acted on, or dismissed — and is the single append-only point that the
-- chat can subscribe to for live updates.

CREATE TABLE IF NOT EXISTS public.suggested_actions (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id             uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source_communication_id uuid        REFERENCES public.communications(id) ON DELETE SET NULL,
  action_type             text        NOT NULL,
  label                   text        NOT NULL,
  params                  jsonb,
  status                  text        NOT NULL DEFAULT 'pending',
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT suggested_actions_type_check CHECK (action_type IN (
    'send_offer', 'book_appointment', 'call_back',
    'request_photos', 'request_details', 'reminder'
  )),
  CONSTRAINT suggested_actions_status_check CHECK (status IN ('pending', 'done', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS suggested_actions_open_idx
  ON public.suggested_actions (business_id, customer_id, status, created_at DESC);

-- RLS (membership pattern) ----------------------------------------------------
ALTER TABLE public.suggested_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suggested_actions_select_business_members" ON public.suggested_actions;
CREATE POLICY "suggested_actions_select_business_members"
  ON public.suggested_actions FOR SELECT TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "suggested_actions_insert_business_members" ON public.suggested_actions;
CREATE POLICY "suggested_actions_insert_business_members"
  ON public.suggested_actions FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "suggested_actions_update_business_members" ON public.suggested_actions;
CREATE POLICY "suggested_actions_update_business_members"
  ON public.suggested_actions FOR UPDATE TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.suggested_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggested_actions TO service_role;
