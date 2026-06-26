-- Opiflow Outbox (transactional outbound delivery)
-- Backs the Outbox pattern for OUTBOUND side-effects (Viber/SMS/email/webhooks):
-- record the intent first, then a worker delivers it with retries + idempotency,
-- so a provider hiccup never loses a message and a retried send is never doubled.
-- See docs/ARCHITECTURE_REFACTOR_PLAN.md (point #7) and src/server/outbox/.
--
-- NOT YET WIRED to any worker; this migration only provisions the schema. Rows are
-- written/claimed exclusively by server-side code using the service role. RLS is
-- enabled with NO public policies (service role bypasses RLS), consistent with
-- jobs (030), provider_webhook_events (003), and audit_events (029).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS. business_id is nullable (system
-- events). dedup_key is an optional caller-supplied idempotency key; a partial
-- UNIQUE index makes a second record() with the same (business_id, dedup_key) a
-- no-op so retries/double-submits collapse to one delivery. updated_at is managed
-- by the app/worker layer, not a trigger (consistent with the rest of the schema).

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid,
  kind          text        NOT NULL,          -- 'viber' | 'sms' | 'email' | 'webhook' | ...
  dedup_key     text,                          -- optional idempotency key
  payload       jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'pending', -- pending|processing|sent|failed
  attempts      integer     NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Worker dispatch index: find due pending events ordered by next_retry_at.
CREATE INDEX IF NOT EXISTS outbox_events_status_retry_idx
  ON public.outbox_events (status, next_retry_at);

-- Idempotency: at most one event per (business_id, dedup_key) when a key is given.
CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_business_dedup_uidx
  ON public.outbox_events (business_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled, no public policies. Service role only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.outbox_events FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.outbox_events FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.outbox_events FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.outbox_events TO service_role;
