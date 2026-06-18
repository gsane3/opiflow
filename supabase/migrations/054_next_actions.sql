-- Migration 054: next_actions — the single "Next Best Action" per scope (CAM).
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Additive + idempotent. Safe to re-run.
--
-- Opiflow is a Customer-Action machine, not a CRM: the technician should see
-- exactly ONE recommended next action per work folder (or per customer when no
-- folder exists yet) — never a list. A deterministic ranker (src/lib/server/
-- next-action.ts) computes the action from existing signals (call brief, folder
-- activity, offers, appointments, uploads, intake, messages); this table persists
-- only the single ACTIVE recommendation and its lifecycle (accept / dismiss /
-- snooze / supersede) so "Όχι τώρα"/"Υπενθύμισέ μου" survive across web/Android/iOS.
--
-- The title/explanation are deterministic Greek templates — they NEVER contain
-- raw transcript or call-brief text. The public /f/[token] portal NEVER reads
-- this table; it is business-only (RLS = business_users membership).
--
-- App code is TOLERANT of this table being absent (reads/writes fall back to a
-- computed-only, non-persistent action), so the PR is safe to review/ship before
-- this SQL is applied.

CREATE TABLE IF NOT EXISTS public.next_actions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id)    ON DELETE CASCADE,
  customer_id       uuid        NOT NULL REFERENCES public.customers(id)     ON DELETE CASCADE,
  work_folder_id    uuid                 REFERENCES public.work_folders(id)  ON DELETE CASCADE,
  action_type       text        NOT NULL,
  title             text        NOT NULL,
  explanation       text,
  confidence        numeric,                        -- 0..1 deterministic-rule confidence
  priority          smallint    NOT NULL DEFAULT 0, -- matched rule rank (lower = higher priority)
  source_event_type text,                           -- e.g. 'call_brief','offer_response' (free text)
  source_event_id   uuid,
  status            text        NOT NULL DEFAULT 'pending',
  due_at            timestamptz,                    -- snooze-until / follow-up due
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT next_actions_type_check CHECK (action_type IN (
    'create_work_folder','share_folder_link','request_photos','request_customer_details',
    'create_offer','schedule_appointment','send_follow_up','reply_to_customer',
    'mark_work_done','no_action')),
  CONSTRAINT next_actions_status_check CHECK (status IN (
    'pending','accepted','dismissed','snoozed','completed','superseded'))
);

-- Exactly ONE active (pending|snoozed) suggestion per scope: folder when present,
-- else customer. Two partial unique indexes enforce the "one active per scope" rule.
CREATE UNIQUE INDEX IF NOT EXISTS next_actions_one_active_folder_idx
  ON public.next_actions (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL AND status IN ('pending','snoozed');
CREATE UNIQUE INDEX IF NOT EXISTS next_actions_one_active_customer_idx
  ON public.next_actions (business_id, customer_id)
  WHERE work_folder_id IS NULL AND status IN ('pending','snoozed');
CREATE INDEX IF NOT EXISTS next_actions_lookup_idx
  ON public.next_actions (business_id, customer_id, status, updated_at DESC);

-- RLS (membership pattern, mirrors migration 041) -----------------------------
ALTER TABLE public.next_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "next_actions_select_business_members" ON public.next_actions;
CREATE POLICY "next_actions_select_business_members"
  ON public.next_actions FOR SELECT TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "next_actions_write_business_members" ON public.next_actions;
CREATE POLICY "next_actions_write_business_members"
  ON public.next_actions FOR ALL TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.next_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.next_actions TO service_role;
