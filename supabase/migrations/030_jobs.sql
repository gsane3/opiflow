-- yorgos.ai Jobs Queue
-- Generic table backing a future asynchronous job queue (e.g. deferred email
-- sends, webhook retries, scheduled follow-ups). A worker process polls for
-- pending rows whose run_at is due, ordered by run_at.
--
-- Not yet wired to any worker; this migration only provisions the schema.
-- Rows are written and claimed exclusively by server-side code using the
-- service role. RLS is enabled with no public policies (service role bypasses
-- RLS), consistent with provider_webhook_events (003) and audit_events (029).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- business_id is nullable with no FK so system-level jobs (not tied to a
-- tenant) can be enqueued. updated_at is managed by the API/worker layer, not
-- by a trigger, consistent with the rest of the schema.

CREATE TABLE IF NOT EXISTS public.jobs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid,
  type        text,
  payload     jsonb,
  status      text        NOT NULL DEFAULT 'pending',
  attempts    integer     NOT NULL DEFAULT 0,
  run_at      timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Worker dispatch index: find due pending jobs (filter status, order by run_at).
CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx
  ON public.jobs (status, run_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS enabled, no public policies. Service role bypasses RLS and is the only
-- principal that enqueues, claims, or completes jobs.

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- (No policies created for jobs by design.)

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- No grants to anon or authenticated. Service role only.

REVOKE ALL PRIVILEGES ON TABLE public.jobs FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.jobs FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.jobs FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jobs TO service_role;
