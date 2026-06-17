-- 051: multiple bank accounts per business.
--
-- The business can store several bank accounts (Settings → Τραπεζικά: + button).
-- The PRIMARY account (lowest sort_order) is mirrored back into businesses.bank_*
-- so the existing payment-request / portal / offer-PDF read paths stay UNCHANGED.
-- Service-role only (RLS on, no policies → denied to anon/auth, bypassed by the
-- service role); the API scopes every query by business_id explicitly. Backfills
-- the existing single bank (businesses.bank_*) into a first row.

CREATE TABLE IF NOT EXISTS public.business_bank_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  beneficiary text,
  bank_name   text,
  iban        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_biz
  ON public.business_bank_accounts (business_id, sort_order);

ALTER TABLE public.business_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Backfill: existing single bank (businesses.bank_*) → first account.
INSERT INTO public.business_bank_accounts (business_id, beneficiary, bank_name, iban, sort_order)
SELECT b.id, b.bank_beneficiary, b.bank_name, b.bank_iban, 0
FROM public.businesses b
WHERE b.bank_iban IS NOT NULL AND btrim(b.bank_iban) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.business_bank_accounts a WHERE a.business_id = b.id);
