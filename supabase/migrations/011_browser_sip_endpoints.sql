-- yorgos.ai Browser SIP Endpoint Metadata
-- Adds browser_sip_endpoints (per-business endpoint metadata for future WebRTC calling).
-- Adds the idempotent function public.ensure_browser_sip_endpoint.
--
-- Safe to run after 010_phone_number_pool.sql.
-- Uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS throughout.
-- Policy names are explicit. DROP POLICY IF EXISTS precedes each CREATE POLICY.
--
-- IMPORTANT: This table stores endpoint metadata only.
-- No SIP password column. No trunk/provider credentials. No password hash.
-- Password provisioning is deferred to a future migration after Asterisk WSS
-- is confirmed working and the managed number model is commercially confirmed.
--
-- browser_sip_endpoints is readable by business members via RLS but
-- writable only by service_role (provisioning is backend-only).

-- ---------------------------------------------------------------------------
-- browser_sip_endpoints
-- ---------------------------------------------------------------------------
-- One row per business browser SIP endpoint.
-- Created by ensure_browser_sip_endpoint, never by authenticated users.
-- Status lifecycle: planned -> active -> suspended | revoked.

CREATE TABLE IF NOT EXISTS public.browser_sip_endpoints (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid        NOT NULL REFERENCES public.businesses(id)             ON DELETE CASCADE,
  business_phone_number_id uuid       REFERENCES public.business_phone_numbers(id)          ON DELETE SET NULL,
  user_id                 uuid        REFERENCES auth.users(id)                             ON DELETE SET NULL,
  sip_username            text        NOT NULL,
  sip_realm               text,
  wss_url                 text,
  endpoint_type           text        NOT NULL DEFAULT 'browser',
  status                  text        NOT NULL DEFAULT 'planned',
  expires_at              timestamptz,
  last_issued_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT browser_sip_endpoints_sip_username_unique
    UNIQUE (sip_username),

  CONSTRAINT browser_sip_endpoints_status_check
    CHECK (status IN ('planned', 'active', 'suspended', 'revoked')),

  CONSTRAINT browser_sip_endpoints_endpoint_type_check
    CHECK (endpoint_type IN ('browser'))
);

CREATE INDEX IF NOT EXISTS browser_sip_endpoints_business_id_idx
  ON public.browser_sip_endpoints (business_id);

CREATE INDEX IF NOT EXISTS browser_sip_endpoints_business_phone_number_id_idx
  ON public.browser_sip_endpoints (business_phone_number_id);

CREATE INDEX IF NOT EXISTS browser_sip_endpoints_user_id_idx
  ON public.browser_sip_endpoints (user_id);

CREATE INDEX IF NOT EXISTS browser_sip_endpoints_status_idx
  ON public.browser_sip_endpoints (status);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.browser_sip_endpoints ENABLE ROW LEVEL SECURITY;

-- browser_sip_endpoints: SELECT for business members only.
-- Authenticated users may read endpoint rows for businesses they belong to
-- through business_users. No authenticated INSERT/UPDATE/DELETE.
-- Provisioning is backend-only via service_role.

DROP POLICY IF EXISTS "browser_sip_endpoints_select_business_members" ON public.browser_sip_endpoints;
CREATE POLICY "browser_sip_endpoints_select_business_members"
  ON public.browser_sip_endpoints
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- browser_sip_endpoints: authenticated may SELECT (RLS enforces per-business scope).
-- No INSERT/UPDATE/DELETE for authenticated. service_role has full access.

REVOKE ALL PRIVILEGES ON TABLE public.browser_sip_endpoints FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.browser_sip_endpoints FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.browser_sip_endpoints FROM service_role;

GRANT SELECT                         ON TABLE public.browser_sip_endpoints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.browser_sip_endpoints TO service_role;

-- ---------------------------------------------------------------------------
-- Idempotent browser SIP endpoint creation function
-- ---------------------------------------------------------------------------
-- Called server-side via service_role RPC when the browser requests endpoint
-- readiness state.
-- Idempotent: if the business already has a non-revoked endpoint, returns it.
-- Only creates an endpoint if the business has an active business_phone_numbers row.
-- If no active number is assigned, returns an empty result set (0 rows).
-- sip_username is deterministic: 'biz_' || business_id without hyphens.
-- No SIP password is generated or stored in this slice.
-- SECURITY DEFINER with explicit search_path prevents search-path injection.
-- Execute is restricted to service_role only.

CREATE OR REPLACE FUNCTION public.ensure_browser_sip_endpoint(
  p_business_id uuid,
  p_user_id     uuid DEFAULT NULL
)
RETURNS TABLE (
  sip_username    text,
  status          text,
  wss_url         text,
  expires_at      timestamptz,
  last_issued_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bpn_id         uuid;
  v_computed_user  text;
BEGIN
  -- Require an active business_phone_numbers row before creating any endpoint.
  SELECT bpn.id
  INTO   v_bpn_id
  FROM   public.business_phone_numbers bpn
  WHERE  bpn.business_id = p_business_id
    AND  bpn.status = 'active'
  LIMIT  1;

  -- No active number assigned. Return empty result to signal the caller.
  IF v_bpn_id IS NULL THEN
    RETURN;
  END IF;

  -- Deterministic sip_username derived from business_id. Not a secret.
  v_computed_user := 'biz_' || replace(p_business_id::text, '-', '');

  -- Insert a planned endpoint if no non-revoked endpoint exists for this business.
  -- ON CONFLICT (sip_username) DO NOTHING handles the concurrent-insert race condition:
  -- if two calls race past the WHERE NOT EXISTS check, the loser is silently ignored
  -- and the subsequent SELECT returns the winner's row.
  INSERT INTO public.browser_sip_endpoints (
    business_id,
    business_phone_number_id,
    user_id,
    sip_username,
    status
  )
  SELECT
    p_business_id,
    v_bpn_id,
    p_user_id,
    v_computed_user,
    'planned'
  WHERE NOT EXISTS (
    SELECT 1
    FROM   public.browser_sip_endpoints bse
    WHERE  bse.business_id = p_business_id
      AND  bse.status != 'revoked'
  )
  ON CONFLICT (sip_username) DO NOTHING;

  -- Return the current non-revoked endpoint for this business.
  RETURN QUERY
    SELECT bse.sip_username,
           bse.status,
           bse.wss_url,
           bse.expires_at,
           bse.last_issued_at
    FROM   public.browser_sip_endpoints bse
    WHERE  bse.business_id = p_business_id
      AND  bse.status != 'revoked'
    LIMIT  1;
END;
$$;

-- Restrict execute: revoke from PUBLIC and authenticated, grant only to service_role.
-- SECURITY DEFINER functions are executable by PUBLIC by default in PostgreSQL,
-- so an explicit revoke is required.
REVOKE EXECUTE ON FUNCTION public.ensure_browser_sip_endpoint(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_browser_sip_endpoint(uuid, uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_browser_sip_endpoint(uuid, uuid) TO service_role;
