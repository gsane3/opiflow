-- Migration 022: Settings DB sync.
-- Adds UPDATE policy for authenticated business owners so that
-- PATCH /api/businesses/me can persist profile edits to the database.
-- Adds service_role UPDATE grant for server-side routes that use
-- createServerSupabaseClient (which bypasses RLS but still needs the privilege).
--
-- No table schema changes.
-- No owner_name column added (localStorage-only in this slice).
-- No logo storage added (logo_url management deferred).
-- No DELETE grants.
-- No anon grants.
--
-- GRANT is idempotent in PostgreSQL.
-- DROP POLICY IF EXISTS makes the CREATE POLICY safe to re-run.

-- Allow authenticated users to UPDATE their own business row.
GRANT UPDATE ON public.businesses TO authenticated;

-- Allow server-side routes (service_role client) to UPDATE businesses.
GRANT UPDATE ON public.businesses TO service_role;

-- UPDATE policy: a business owner may update only their own row.
DROP POLICY IF EXISTS "businesses_update_own" ON public.businesses;

CREATE POLICY "businesses_update_own"
  ON public.businesses
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
