-- yorgos.ai Audit Events
-- Append-only audit log of meaningful actions taken in the system.
-- Rows are written by trusted server API routes using the service role only.
--
-- RLS is enabled with NO authenticated/anon policies: only the service role
-- (which bypasses RLS) may read or write this table. This matches the pattern
-- used by provider_webhook_events (003) and the token tables (005/008/009).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- business_id and actor_user_id are nullable and intentionally have NO foreign
-- key constraints, so audit rows survive deletion of the business or user they
-- reference (audit trails must outlive the entities they describe).

CREATE TABLE IF NOT EXISTS public.audit_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid,
  actor_user_id uuid,
  action        text        NOT NULL,
  entity_type   text,
  entity_id     text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_business_created_desc_idx
  ON public.audit_events (business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS enabled, no public policies. Service role bypasses RLS and is the only
-- principal that can read or write audit events.

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- (No policies created for audit_events by design.)

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- No grants to anon or authenticated. Service role only.

REVOKE ALL PRIVILEGES ON TABLE public.audit_events FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.audit_events FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.audit_events FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_events TO service_role;
