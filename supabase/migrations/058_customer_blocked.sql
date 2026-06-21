-- Migration 058 — block a contact/number.
-- Apply manually via the Supabase SQL editor (live project oluhmztfimmgmbxoioea).
--
-- A blocked customer's inbound calls are rejected by the Twilio inbound webhook
-- (like the DND switch). Nullable/defaulted so the API layer keeps working
-- before this migration is applied (reads/writes are tolerant — see
-- src/app/api/customers/[id] and the inbound webhook).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;

-- Fast "is this caller blocked?" lookups, per business.
CREATE INDEX IF NOT EXISTS customers_business_blocked_idx
  ON public.customers (business_id, blocked);
