-- Migration 060 — per-business call EXEMPTION list (#9).
-- Apply manually via the Supabase SQL editor (live project oluhmztfimmgmbxoioea).
--
-- Numbers in this list are EXEMPT from BOTH the «η κλήση ηχογραφείται» disclosure
-- AND from recording — the owner's personal contacts (friends/family) who call the
-- same number they use for business and must not be recorded. Decoupled from
-- `customers` on purpose: exempting personal contacts must NOT turn them into CRM
-- customers. `phone` holds the last-10 normalized digits for format-tolerant matching
-- (same scheme as the blocked-caller + customer phone matching elsewhere).
--
-- The API layer and the call path are TOLERANT of this table being absent (it
-- degrades to "no exemptions") so nothing breaks before the migration is applied.

CREATE TABLE IF NOT EXISTS public.business_exempt_numbers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per (business, number); also the fast "is this caller exempt?" lookup.
CREATE UNIQUE INDEX IF NOT EXISTS business_exempt_numbers_biz_phone_idx
  ON public.business_exempt_numbers (business_id, phone);
