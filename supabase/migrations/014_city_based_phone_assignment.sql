-- Track B: City-based phone number assignment
-- Replaces the single-argument assign_available_phone_number(p_business_id) with a
-- two-argument version that accepts an optional city hint.
--
-- Backward compatibility:
--   Old call: assign_available_phone_number(p_business_id)
--     -> p_city defaults to NULL, behavior is identical to previous version.
--   New call: assign_available_phone_number(p_business_id, p_city)
--     -> prefers an available number tagged with that city; falls back to global pool.
--
-- The old single-argument overload is dropped first to prevent ambiguity.
-- All other application code is unchanged.

-- ---------------------------------------------------------------------------
-- Drop old single-argument function
-- ---------------------------------------------------------------------------
-- Required: PostgreSQL cannot replace a function by adding a defaulted parameter
-- without leaving both overloads. Dropping the old signature ensures only one
-- version exists and the existing single-argument RPC call resolves cleanly.

DROP FUNCTION IF EXISTS public.assign_available_phone_number(uuid);

-- ---------------------------------------------------------------------------
-- New function: assign_available_phone_number(p_business_id, p_city)
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

  RETURN QUERY SELECT true, v_pool_id, v_pool_e164;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Apply the same access model as migration 010: service_role only.
-- The function is SECURITY DEFINER so it runs as the definer regardless,
-- but restricting EXECUTE prevents unauthorised direct calls.

REVOKE EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.assign_available_phone_number(uuid, text) TO service_role;
