-- Migration 035: Preferred contact channel expansion + intake reminder bookkeeping.
--
-- Two additive, idempotent changes. Safe to re-run on a live table.
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
--
-- 1. customers.preferred_contact_method:
--    The original CHECK constraint (customers_preferred_contact_method_check,
--    defined in 003_crm_core.sql) only allowed ('viber', 'email', 'phone').
--    This widens it to also allow 'whatsapp' and 'sms' so the per-customer
--    preferred channel can target those messaging apps. The column DEFAULT
--    stays 'phone' and the column stays NOT NULL — only the allowed value set
--    grows, so every existing row remains valid. We DROP IF EXISTS then ADD,
--    keeping the same constraint name, which makes the change re-runnable.
--
-- 2. customer_intake_tokens reminder bookkeeping:
--    Adds reminder_sent_at (when the intake reminder was last sent) and
--    reminder_count (how many reminders have been sent, default 0) so the
--    reminder pipeline can track follow-ups. Both use ADD COLUMN IF NOT EXISTS.
--    No indexes, RLS, or grant changes needed — service_role already has full
--    access to this table (see 005_customer_intake_tokens.sql).

-- ---------------------------------------------------------------------------
-- 1. Widen customers.preferred_contact_method CHECK constraint
-- ---------------------------------------------------------------------------

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_preferred_contact_method_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_preferred_contact_method_check
    CHECK (preferred_contact_method IN ('viber', 'whatsapp', 'sms', 'email', 'phone'));

-- ---------------------------------------------------------------------------
-- 2. Intake reminder bookkeeping columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_intake_tokens
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count   int NOT NULL DEFAULT 0;
