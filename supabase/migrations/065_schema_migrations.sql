-- 065: migration tracking.
--
-- Until now there was no record of WHICH migrations are applied to the live DB
-- (they're pasted into the Supabase SQL editor by hand), so drift between the repo
-- and the database could only be found by reading code failures. This table records
-- each applied migration; `scripts/check-migrations.mjs` diffs it against the files
-- in supabase/migrations/ and reports anything missing.
--
-- CONVENTION (going forward): every NEW migration ends with a self-record line:
--   INSERT INTO public.schema_migrations (version, filename)
--   VALUES ('NNN','NNN_name.sql') ON CONFLICT (version) DO NOTHING;
-- so pasting it into the SQL editor also records it. The historical migrations
-- (001..064, already applied) are backfilled once with:
--   node scripts/check-migrations.mjs --backfill
--
-- Service-role only (ops table), matching outbox_events (063) / jobs (030).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    text        PRIMARY KEY,   -- numeric prefix, e.g. '001', '064'
  filename   text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.schema_migrations TO service_role;

-- Self-record this migration.
INSERT INTO public.schema_migrations (version, filename)
VALUES ('065', '065_schema_migrations.sql')
ON CONFLICT (version) DO NOTHING;
