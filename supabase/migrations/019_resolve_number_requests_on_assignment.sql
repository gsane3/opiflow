-- Resolve pending phone number requests on assignment
--
-- Extends assign_available_phone_number to atomically resolve any pending
-- phone_number_requests row for a business when a number is successfully
-- assigned to that business.
--
-- Two resolution points are added:
--
--   1. Idempotency path: the business already has an active assigned number.
--      Resolves any stale pending request so admin views stay clean.
--
--   2. New assignment path: a fresh number is assigned from the pool.
--      Resolves the pending request in the same transaction as the assignment.
--
-- The no-number-available path (pool exhausted) is unchanged: no pending
-- request is resolved, and the function still returns (false, NULL, NULL).
--
-- This migration uses CREATE OR REPLACE FUNCTION and is safe to re-run.
-- All existing assignment behavior from migration 014 is preserved verbatim.
-- No other functions are modified.

-- ---------------------------------------------------------------------------
-- Drop old single-argument overload (mirror of migration 014 safety drop).
-- Should already be absent, but kept for defensive idempotency.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.assign_available_phone_number(uuid);

-- ---------------------------------------------------------------------------
-- assign_available_phone_number(p_business_id, p_city)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_available_phone_number(
  p_business_id uuid,
  p_city        text DEFAULT NULL
)
RETURNS TABLE (
  assigned                boolean,
  managed_phone_number_id uuid,
  e164_number             text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_mpn_id  uuid;
  v_existing_e164    text;
  v_pool_id          uuid;
  v_pool_e164        text;
  v_pool_provider    text;
  v_trimmed_city     text;
BEGIN
  -- Idempotency: if this business already has an active assignment, return it unchanged.
  SELECT bpn.managed_phone_number_id, bpn.e164_number
  INTO   v_existing_mpn_id, v_existing_e164
  FROM   public.business_phone_numbers bpn
  WHERE  bpn.business_id = p_business_id
    AND  bpn.status = 'active'
  LIMIT  1;

  IF v_existing_mpn_id IS NOT NULL THEN
    -- Resolve any stale pending request for this business.
    -- No-op when there is no pending request.
    UPDATE public.phone_number_requests
    SET    status                   = 'resolved',
           resolved_at              = now(),
           resolved_phone_number_id = v_existing_mpn_id,
           updated_at               = now()
    WHERE  business_id = p_business_id
      AND  status      = 'pending';

    RETURN QUERY SELECT true, v_existing_mpn_id, v_existing_e164;
    RETURN;
  END IF;

  -- Normalise city hint: collapse empty string and surrounding whitespace to NULL.
  v_trimmed_city := NULLIF(TRIM(COALESCE(p_city, '')), '');

  -- Step 1 (city match): if a city hint is present, try to lock the oldest available
  -- platform_owned number whose city matches case-insensitively.
  -- NULL city on a pool number is never matched (LOWER(NULL) IS NULL).
  IF v_trimmed_city IS NOT NULL THEN
    SELECT   mpn.id, mpn.e164_number, mpn.provider
    INTO     v_pool_id, v_pool_e164, v_pool_provider
    FROM     public.managed_phone_numbers mpn
    WHERE    mpn.status      = 'available'
      AND    mpn.number_type = 'platform_owned'
      AND    LOWER(TRIM(mpn.city)) = LOWER(v_trimmed_city)
    ORDER BY mpn.imported_at ASC
    LIMIT    1
    FOR UPDATE SKIP LOCKED;
  END IF;

  -- Step 2 (global fallback): if no city-matched number was found, pick the oldest
  -- available platform_owned number regardless of city.
  IF v_pool_id IS NULL THEN
    SELECT   mpn.id, mpn.e164_number, mpn.provider
    INTO     v_pool_id, v_pool_e164, v_pool_provider
    FROM     public.managed_phone_numbers mpn
    WHERE    mpn.status      = 'available'
      AND    mpn.number_type = 'platform_owned'
    ORDER BY mpn.imported_at ASC
    LIMIT    1
    FOR UPDATE SKIP LOCKED;
  END IF;

  -- Pool exhausted or all candidate rows are locked by a concurrent transaction.
  -- Do not resolve any pending request: the business still needs a number.
  IF v_pool_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Mark the pool number as assigned. Clear any residual cooldown fields that
  -- could be present if the number was previously released.
  UPDATE public.managed_phone_numbers
  SET    status             = 'assigned',
         assigned_at        = now(),
         cooling_down_since = NULL,
         available_after    = NULL,
         updated_at         = now()
  WHERE  id = v_pool_id;

  -- Insert the business assignment row.
  INSERT INTO public.business_phone_numbers (
    business_id,
    managed_phone_number_id,
    e164_number,
    provider,
    status,
    assigned_at
  ) VALUES (
    p_business_id,
    v_pool_id,
    v_pool_e164,
    v_pool_provider,
    'active',
    now()
  );

  -- Update the denormalised column on businesses for fast single-column access.
  -- Also backfill businesses.city from the hint when the business has none yet.
  -- This does not overwrite a city the business already has.
  UPDATE public.businesses
  SET    business_phone_number = v_pool_e164,
         city = CASE
                  WHEN v_trimmed_city IS NOT NULL AND city IS NULL THEN v_trimmed_city
                  ELSE city
                END
  WHERE  id = p_business_id;

  -- Append an assignment record to the history log.
  INSERT INTO public.business_phone_number_assignment_history (
    business_id,
    managed_phone_number_id,
    e164_number,
    provider,
    status,
    assigned_at
  ) VALUES (
    p_business_id,
    v_pool_id,
    v_pool_e164,
    v_pool_provider,
    'assigned',
    now()
  );

  -- Resolve any pending phone number request for this business.
  -- v_pool_id is the managed_phone_numbers.id just assigned.
  -- No-op when there is no pending request.
  UPDATE public.phone_number_requests
  SET    status                   = 'resolved',
         resolved_at              = now(),
         resolved_phone_number_id = v_pool_id,
         updated_at               = now()
  WHERE  business_id = p_business_id
    AND  status      = 'pending';

  RETURN QUERY SELECT true, v_pool_id, v_pool_e164;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Identical to migration 014: service_role only.
-- SECURITY DEFINER functions are PUBLIC-executable by default in PostgreSQL;
-- explicit revoke is required.

REVOKE EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) TO service_role;
