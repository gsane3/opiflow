-- yorgos.ai Backend Phase 3 CRM Core
-- Adds core CRM tables that are not blocked by voice provider selection.
-- Voice, recordings, transcripts, AI briefs, intake links, Viber messages, and offers are intentionally deferred.
--
-- Safe to run after 001_initial.sql and 002_grants.sql.
-- Uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS throughout.
-- Policy names are explicit; DROP POLICY IF EXISTS is used before each CREATE POLICY for idempotency.
-- updated_at columns are managed by the API layer, not by triggers, in Phase 3.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
-- One row per CRM contact. Replaces the localStorage customers array.
-- crm_number is a display-only sequential label (#1, #2, ...) managed by the
-- API, not enforced as unique by the database in Phase 3.
-- phone, mobile_phone, landline_phone are stored in E.164 format by the API.
-- offer_drafts, call records, and intake links will add FK columns in later migrations.

CREATE TABLE IF NOT EXISTS public.customers (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  crm_number               text,
  name                     text,
  company_name             text,
  phone                    text,
  mobile_phone             text,
  landline_phone           text,
  email                    text,
  address                  text,
  source                   text,
  status                   text        NOT NULL DEFAULT 'new_lead',
  opportunity_value        numeric,
  needs_summary            text,
  notes                    text,
  preferred_contact_method text        NOT NULL DEFAULT 'phone',
  intake_status            text        NOT NULL DEFAULT 'none',
  last_contact_at          timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customers_status_check
    CHECK (status IN ('new_lead', 'contacted', 'follow_up_needed', 'offer_drafted', 'offer_sent', 'won', 'lost')),

  CONSTRAINT customers_preferred_contact_method_check
    CHECK (preferred_contact_method IN ('viber', 'email', 'phone')),

  CONSTRAINT customers_intake_status_check
    CHECK (intake_status IN ('none', 'pending', 'sent', 'opened', 'submitted', 'expired', 'revoked')),

  CONSTRAINT customers_source_check
    CHECK (source IS NULL OR source IN (
      'facebook_ads', 'google_ads', 'website_form', 'referral',
      'inbound_call', 'missed_call', 'manual_entry', 'other'
    ))
);

CREATE INDEX IF NOT EXISTS customers_business_id_idx
  ON public.customers (business_id);

CREATE INDEX IF NOT EXISTS customers_business_phone_idx
  ON public.customers (business_id, phone);

CREATE INDEX IF NOT EXISTS customers_business_mobile_phone_idx
  ON public.customers (business_id, mobile_phone);

CREATE INDEX IF NOT EXISTS customers_business_status_idx
  ON public.customers (business_id, status);

CREATE INDEX IF NOT EXISTS customers_business_crm_number_idx
  ON public.customers (business_id, crm_number);

-- ---------------------------------------------------------------------------
-- communications
-- ---------------------------------------------------------------------------
-- Outbound/inbound communication log for calls, SMS, Viber, and email.
-- Serves as the backbone of the customer timeline.
-- customer_id is nullable to allow unmatched inbound events before matching.
-- Replaces the localStorage communications array and extends channel to include viber.

CREATE TABLE IF NOT EXISTS public.communications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  channel     text        NOT NULL,
  direction   text        NOT NULL,
  status      text        NOT NULL,
  phone       text,
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT communications_channel_check
    CHECK (channel IN ('call', 'sms', 'viber', 'email')),

  CONSTRAINT communications_direction_check
    CHECK (direction IN ('inbound', 'outbound')),

  CONSTRAINT communications_status_check
    CHECK (status IN ('started', 'sent', 'delivered', 'seen', 'failed', 'completed'))
);

CREATE INDEX IF NOT EXISTS communications_business_customer_idx
  ON public.communications (business_id, customer_id);

CREATE INDEX IF NOT EXISTS communications_business_channel_created_idx
  ON public.communications (business_id, channel, created_at);

CREATE INDEX IF NOT EXISTS communications_business_created_idx
  ON public.communications (business_id, created_at);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
-- Follow-up tasks and appointments. Replaces the localStorage tasks array.
-- status includes ai_draft for AI-proposed tasks pending user confirmation.
-- offer_id and source_brief_id are bare uuid columns without FK constraints;
-- the referenced tables (offers, ai_briefs) are deferred to later migrations.
-- FK constraints for those columns will be added via ALTER TABLE when
-- the referenced tables are created.

CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  offer_id        uuid,
  source_brief_id uuid,
  title           text        NOT NULL,
  type            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'open',
  priority        text        NOT NULL DEFAULT 'normal',
  due_date        date        NOT NULL,
  due_time        text,
  note            text,
  created_from_ai boolean     NOT NULL DEFAULT false,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_type_check
    CHECK (type IN (
      'call_back', 'send_offer', 'follow_up_offer', 'ask_for_photos_documents',
      'book_appointment', 'visit_customer', 'wait_for_reply', 'other'
    )),

  CONSTRAINT tasks_status_check
    CHECK (status IN ('open', 'completed', 'cancelled', 'ai_draft')),

  CONSTRAINT tasks_priority_check
    CHECK (priority IN ('low', 'normal', 'high')),

  CONSTRAINT tasks_due_time_format_check
    CHECK (due_time IS NULL OR due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE INDEX IF NOT EXISTS tasks_business_customer_status_idx
  ON public.tasks (business_id, customer_id, status);

CREATE INDEX IF NOT EXISTS tasks_business_due_status_idx
  ON public.tasks (business_id, due_date, status);

CREATE INDEX IF NOT EXISTS tasks_business_status_idx
  ON public.tasks (business_id, status);

-- ---------------------------------------------------------------------------
-- provider_webhook_events
-- ---------------------------------------------------------------------------
-- Immutable raw event log for all provider webhook payloads.
-- Enables idempotency, replay, and audit for Apifon, Telnyx, and future PBX.
-- event_id is nullable because not all providers include a stable event ID.
-- The partial unique index enforces idempotency when event_id is present.
-- No authenticated RLS policies: only service_role may access this table.

CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text        NOT NULL,
  event_id      text,
  event_type    text,
  payload       jsonb       NOT NULL,
  processed     boolean     NOT NULL DEFAULT false,
  processed_at  timestamptz,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_webhook_events_provider_check
    CHECK (provider IN ('apifon', 'telnyx', 'pbx'))
);

-- Partial unique index: only enforce uniqueness when event_id is not null.
-- This prevents duplicate processing of the same provider event.
CREATE UNIQUE INDEX IF NOT EXISTS provider_webhook_events_provider_event_id_unique
  ON public.provider_webhook_events (provider, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_webhook_events_processed_created_idx
  ON public.provider_webhook_events (processed, created_at);

CREATE INDEX IF NOT EXISTS provider_webhook_events_created_idx
  ON public.provider_webhook_events (created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- All four tables have RLS enabled.
-- CRM tables (customers, communications, tasks) use business_users membership.
-- provider_webhook_events has RLS enabled but NO authenticated policies:
-- only service_role (which bypasses RLS) may read or write it server-side.

ALTER TABLE public.customers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS: customers
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "customers_select_business_members" ON public.customers;
CREATE POLICY "customers_select_business_members"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customers_insert_business_members" ON public.customers;
CREATE POLICY "customers_insert_business_members"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "customers_update_business_members" ON public.customers;
CREATE POLICY "customers_update_business_members"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

-- DELETE policy intentionally omitted in Phase 3.

-- ---------------------------------------------------------------------------
-- RLS: communications
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "communications_select_business_members" ON public.communications;
CREATE POLICY "communications_select_business_members"
  ON public.communications
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "communications_insert_business_members" ON public.communications;
CREATE POLICY "communications_insert_business_members"
  ON public.communications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "communications_update_business_members" ON public.communications;
CREATE POLICY "communications_update_business_members"
  ON public.communications
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

-- DELETE policy intentionally omitted in Phase 3.

-- ---------------------------------------------------------------------------
-- RLS: tasks
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "tasks_select_business_members" ON public.tasks;
CREATE POLICY "tasks_select_business_members"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_insert_business_members" ON public.tasks;
CREATE POLICY "tasks_insert_business_members"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_update_business_members" ON public.tasks;
CREATE POLICY "tasks_update_business_members"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

-- DELETE policy intentionally omitted in Phase 3.

-- ---------------------------------------------------------------------------
-- RLS: provider_webhook_events
-- ---------------------------------------------------------------------------
-- No authenticated policies.
-- service_role bypasses RLS and accesses this table server-side only.
-- Authenticated users cannot read or write raw provider payloads.

-- (No policies created for provider_webhook_events by design.)

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- authenticated role: DML rights on CRM tables only.
-- NO grant to authenticated on provider_webhook_events.
-- service_role: full access on all four tables.

GRANT SELECT, INSERT, UPDATE ON public.customers               TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.communications          TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tasks                   TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communications          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks                   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_webhook_events TO service_role;
