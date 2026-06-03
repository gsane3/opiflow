-- yorgos.ai Row Level Security Hardening (defense-in-depth)
--
-- IMPORTANT: The application connects to Supabase using the SERVICE-ROLE key for
-- all server-side data access. The service role BYPASSES Row Level Security
-- entirely. None of the policies in this file affect the running application.
--
-- These policies exist purely as DEFENSE-IN-DEPTH. If the anon key (or a user's
-- authenticated JWT) were ever leaked and used against the Data API directly,
-- RLS must guarantee that a row is only ever visible/mutable by the owner or a
-- member of its business_id tenant. The service role is unaffected and continues
-- to have full access (it always bypasses RLS).
--
-- Ownership model (real, as defined in 001_initial.sql):
--   * businesses.owner_id           -> auth.users(id)   (the owner)
--   * business_users(business_id,    user_id, role)     (membership, incl. owner)
-- Access is granted to any user who has a business_users membership row for the
-- row's business_id. This matches the existing policy style in 003/007.
--
-- This migration is idempotent:
--   * ENABLE ROW LEVEL SECURITY is a no-op when already enabled.
--   * Each policy is dropped (IF EXISTS) and recreated.
--
-- NOTE: The token tables (customer_intake_tokens, offer_response_tokens,
-- appointment_response_tokens, customer_upload_tokens) are INTENTIONALLY left
-- with RLS enabled and NO authenticated/anon policies, exactly as their original
-- migrations created them. They hold token hashes for public links and must only
-- ever be reachable through trusted server API routes using the service role.
-- Adding an authenticated policy would WEAKEN that posture, so we deliberately do
-- not. We only (idempotently) re-assert that RLS is enabled on them here.

-- ---------------------------------------------------------------------------
-- Ensure RLS is enabled on every per-tenant table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.customers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers                      ENABLE ROW LEVEL SECURITY;

-- Token tables: RLS stays ON with no public policies (service-role only).
ALTER TABLE public.customer_intake_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_response_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_response_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_upload_tokens      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS: customers  (defense-in-depth; mirrors 003_crm_core.sql)
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

-- ---------------------------------------------------------------------------
-- RLS: communications  (defense-in-depth; mirrors 003_crm_core.sql)
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

-- ---------------------------------------------------------------------------
-- RLS: tasks  (defense-in-depth; mirrors 003_crm_core.sql)
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

-- ---------------------------------------------------------------------------
-- RLS: offers  (defense-in-depth; mirrors 007_offers_core.sql)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "offers_select_business_members" ON public.offers;
CREATE POLICY "offers_select_business_members"
  ON public.offers
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "offers_insert_business_members" ON public.offers;
CREATE POLICY "offers_insert_business_members"
  ON public.offers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "offers_update_business_members" ON public.offers;
CREATE POLICY "offers_update_business_members"
  ON public.offers
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

-- ---------------------------------------------------------------------------
-- Token tables: no authenticated/anon policies by design.
-- ---------------------------------------------------------------------------
-- customer_intake_tokens, offer_response_tokens, appointment_response_tokens,
-- and customer_upload_tokens remain reachable only via the service role.
-- (No policies are created here on purpose.)
