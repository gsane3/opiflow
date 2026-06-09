-- Migration 042: Drop WhatsApp from the preferred contact channel set.
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Idempotent: remaps existing 'whatsapp' rows first, then tightens the CHECK.
--
-- The redesign's communication waterfall is: mobile -> Viber (auto-fallback to SMS),
-- landline -> Email. WhatsApp is removed as a channel. 035 had widened the set to
-- include 'whatsapp' and 'sms'; this narrows it back to ('viber','sms','email','phone').

-- 1. Remap any existing whatsapp preference to viber (the mobile default channel).
UPDATE public.customers SET preferred_contact_method = 'viber'
 WHERE preferred_contact_method = 'whatsapp';

-- 2. Tighten the CHECK (drop-then-add keeps the same name -> re-runnable).
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_preferred_contact_method_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_preferred_contact_method_check
    CHECK (preferred_contact_method IN ('viber', 'sms', 'email', 'phone'));
