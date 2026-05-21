-- yorgos.ai Viber message persistence for Apifon intake delivery.
-- Stores one row per outbound Viber message sent, skipped, or failed.
-- Status fields are updated by the Apifon status callback webhook.
-- No authenticated or anon policies: only service_role accesses this table.
--
-- Safe to run after 003_crm_core.sql, 004_harden_crm_core_grants.sql,
-- and 005_customer_intake_tokens.sql.
-- Uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS public.viber_messages (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id            uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  communication_id       uuid        REFERENCES public.communications(id) ON DELETE SET NULL,
  intake_token_id        uuid        REFERENCES public.customer_intake_tokens(id) ON DELETE SET NULL,
  provider               text        NOT NULL DEFAULT 'apifon',
  provider_request_id    text,
  provider_message_id    text,
  reference_id           text,
  recipient_phone        text,
  sender_id              text,
  status                 text        NOT NULL DEFAULT 'created',
  status_code            text,
  status_text            text,
  last_provider_event_id uuid        REFERENCES public.provider_webhook_events(id) ON DELETE SET NULL,
  raw_send_response      jsonb,
  raw_status_payload     jsonb,
  error                  text,
  sent_at                timestamptz,
  delivered_at           timestamptz,
  failed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Business + customer timeline queries
CREATE INDEX IF NOT EXISTS viber_messages_business_customer_created_idx
  ON public.viber_messages (business_id, customer_id, created_at);

-- Intake token lookup
CREATE INDEX IF NOT EXISTS viber_messages_intake_token_idx
  ON public.viber_messages (intake_token_id)
  WHERE intake_token_id IS NOT NULL;

-- Status monitoring
CREATE INDEX IF NOT EXISTS viber_messages_status_created_idx
  ON public.viber_messages (status, created_at);

-- Lookup by provider_message_id for Apifon status callback matching.
-- Partial unique: one row per provider + provider_message_id when present.
CREATE UNIQUE INDEX IF NOT EXISTS viber_messages_provider_message_id_unique
  ON public.viber_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Lookup by provider_request_id for Apifon status callback matching.
-- Partial unique: safe because Phase 3 sends to exactly one subscriber per request.
CREATE UNIQUE INDEX IF NOT EXISTS viber_messages_provider_request_id_unique
  ON public.viber_messages (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;

-- Non-unique index for reference_id fallback lookups
CREATE INDEX IF NOT EXISTS viber_messages_reference_id_idx
  ON public.viber_messages (reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE public.viber_messages ENABLE ROW LEVEL SECURITY;

-- No authenticated or anon policies by design.
-- Viber message creation and status updates happen only through trusted server routes.

REVOKE ALL PRIVILEGES ON TABLE public.viber_messages FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.viber_messages FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.viber_messages FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.viber_messages TO service_role;
