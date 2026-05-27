-- Track B: Release business phone number into 18-month cooldown
--
-- Adds public.release_business_phone_number(p_business_id, p_release_reason).
--
-- Behavior by number_type:
--   platform_owned  -> status = 'cooling_down' for 18 months; cannot be reassigned
--                      until available_after has elapsed (a separate admin process
--                      moves it back to 'available').
--   customer_ported -> no platform cooldown; status management left to operator;
--                      assignment row is released and history is recorded.
--
-- This function does NOT add billing logic, does NOT expire cooldown automatically,
-- and does NOT touch the assign_available_phone_number function.

-- ---------------------------------------------------------------------------
-- Function: release_business_phone_number
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_business_phone_number(
  p_business_id   uuid,
  p_release_reason text DEFAULT 'cancelled'
)
RETURNS TABLE (
  released                boolean,
  managed_phone_number_id uuid,
  e164_number             text,
  available_after         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bpn_mpn_id    uuid;
  v_bpn_e164      text;
  v_number_type   text;
  v_provider      text;
  v_now           timestamptz;
  v_available_after timestamptz;
BEGIN
  v_now := now();

  -- Find and lock the active business_phone_numbers row.
  -- FOR UPDATE prevents a concurrent release or re-assignment from racing.
  SELECT bpn.managed_phone_number_id, bpn.e164_number
  INTO   v_bpn_mpn_id, v_bpn_e164
  FROM   public.business_phone_numbers bpn
  WHERE  bpn.business_id = p_business_id
    AND  bpn.status = 'active'
  FOR UPDATE;

  -- No active assignment: nothing to release.
  IF v_bpn_mpn_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Lock the managed_phone_numbers row to prevent concurrent assignment.
  SELECT mpn.number_type, mpn.provider
  INTO   v_number_type, v_provider
  FROM   public.managed_phone_numbers mpn
  WHERE  mpn.id = v_bpn_mpn_id
  FOR UPDATE;

  -- ---------------------------------------------------------------------------
  -- platform_owned: enter 18-month cooling_down period
  -- ---------------------------------------------------------------------------
  IF v_number_type = 'platform_owned' THEN

    v_available_after := v_now + interval '18 months';

    -- Move pool number into cooling_down state.
    UPDATE public.managed_phone_numbers
    SET    status             = 'cooling_down',
           cooling_down_since = v_now,
           available_after    = v_available_after,
           assigned_at        = NULL,
           updated_at         = v_now
    WHERE  id = v_bpn_mpn_id;

    -- Mark business assignment as released.
    UPDATE public.business_phone_numbers
    SET    status      = 'released',
           released_at = v_now,
           updated_at  = v_now
    WHERE  business_id = p_business_id
      AND  status      = 'active';

    -- Clear the denormalised column on businesses.
    UPDATE public.businesses
    SET    business_phone_number = NULL
    WHERE  id = p_business_id;

    -- Append history record.
    INSERT INTO public.business_phone_number_assignment_history (
      business_id,
      managed_phone_number_id,
      e164_number,
      provider,
      status,
      released_at,
      release_reason,
      cooling_down_until
    ) VALUES (
      p_business_id,
      v_bpn_mpn_id,
      v_bpn_e164,
      v_provider,
      'cooling_down',
      v_now,
      p_release_reason,
      v_available_after
    );

    RETURN QUERY SELECT true, v_bpn_mpn_id, v_bpn_e164, v_available_after;
    RETURN;

  END IF;

  -- ---------------------------------------------------------------------------
  -- customer_ported: release without platform cooldown
  -- No automatic status change on managed_phone_numbers; operator handles porting.
  -- ---------------------------------------------------------------------------

  -- Mark business assignment as released.
  UPDATE public.business_phone_numbers
  SET    status      = 'released',
         released_at = v_now,
         updated_at  = v_now
  WHERE  business_id = p_business_id
    AND  status      = 'active';

  -- Clear the denormalised column on businesses.
  UPDATE public.businesses
  SET    business_phone_number = NULL
  WHERE  id = p_business_id;

  -- Append history record with status = 'released' (no cooldown).
  INSERT INTO public.business_phone_number_assignment_history (
    business_id,
    managed_phone_number_id,
    e164_number,
    provider,
    status,
    released_at,
    release_reason
  ) VALUES (
    p_business_id,
    v_bpn_mpn_id,
    v_bpn_e164,
    v_provider,
    'released',
    v_now,
    p_release_reason
  );

  RETURN QUERY SELECT true, v_bpn_mpn_id, v_bpn_e164, NULL::timestamptz;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Same access model as assign_available_phone_number: service_role only.
-- SECURITY DEFINER functions are PUBLIC-executable by default; explicit revoke required.

REVOKE EXECUTE ON FUNCTION public.release_business_phone_number(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_business_phone_number(uuid, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.release_business_phone_number(uuid, text) TO service_role;
