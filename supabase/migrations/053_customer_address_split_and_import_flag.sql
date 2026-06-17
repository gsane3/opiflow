-- Migration 053 — customer address split + phone-import flag
-- Native feedback batch B (#1, #9). Apply manually via the Supabase SQL editor.
--
-- #1  Split the single freeform `customers.address` into separate, structured
--     fields so the intake form + edit sheet can autocomplete ΤΚ / Περιοχή
--     independently (address stays the street + number). Εταιρεία (company_name)
--     and Ανάγκες (needs_summary) already exist from 003_crm_core.sql.
-- #9  Mark contacts imported from the phone address book so the contacts list
--     can hide them on demand.
--
-- All columns are nullable / defaulted, so existing rows and the API layer keep
-- working even before this migration is applied (the API reads/writes these
-- columns tolerantly — see src/app/api/customers).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS postal_code         text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS region              text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS imported_from_phone boolean NOT NULL DEFAULT false;

-- Filter «κρύψε τις επαφές που μπήκαν από το κινητό» (#9) is per-business.
CREATE INDEX IF NOT EXISTS customers_business_imported_idx
  ON public.customers (business_id, imported_from_phone);
