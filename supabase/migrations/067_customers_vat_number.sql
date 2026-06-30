-- Migration 067 — customer ΑΦΜ (VAT number) for B2B invoicing.
-- Apply manually via the Supabase SQL editor (live project oluhmztfimmgmbxoioea).
--
-- Stores the END-CUSTOMER's ΑΦΜ so the optional AADE/myDATA invoicing add-on can
-- issue a proper B2B service invoice (doc type 2.1) instead of always falling back
-- to a B2C retail receipt (11.2).
--
-- NOTE: the customers CREATE TABLE (003_crm_core.sql) never defined vat_number, yet
-- folders.repo.ts (fetchFolderDetailSources) already SELECTs customers.vat_number —
-- i.e. the live DB has the column ad-hoc/untracked. This migration FORMALIZES it into
-- the tracked schema so fresh databases match prod and check-migrations stays clean.
-- `ADD COLUMN IF NOT EXISTS` → safe no-op where the column already exists.
--
-- Read/written via ISOLATED tolerant helpers (like blocked 058 / postal_code+region
-- 053), so the customer API keeps working even before this migration is applied — see:
--   src/server/modules/customers/customers.repo.ts (fetchCustomerVatNumber / applyCustomerVatNumber)
--   src/server/modules/invoicing/invoicing.repo.ts (getCustomerForInvoice — tolerant select)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS vat_number text;

-- Migration tracking (065 convention).
INSERT INTO public.schema_migrations (version, filename)
VALUES ('067', '067_customers_vat_number.sql')
ON CONFLICT (version) DO NOTHING;
