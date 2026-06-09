-- Migration 039: Simplify customer status lifecycle (7 -> 4).
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Idempotent: maps legacy data first, then swaps the CHECK constraint.
--
-- Old set (003_crm_core): new_lead | contacted | follow_up_needed | offer_drafted
--                         | offer_sent | won | lost
-- New set:                new | in_progress | won | lost
-- Mapping: new_lead -> new ; (contacted, follow_up_needed, offer_drafted, offer_sent) -> in_progress
--
-- MUST be applied together with the lockstep code change (CustomerStatus union,
-- labels, API VALID_STATUSES, AI schema/prompt, status writers). The app writes the
-- new values; this constraint rejects the old ones.

-- 1. Map existing rows to the new vocabulary (run before swapping the CHECK).
UPDATE public.customers SET status = 'in_progress'
 WHERE status IN ('contacted', 'follow_up_needed', 'offer_drafted', 'offer_sent');

UPDATE public.customers SET status = 'new'
 WHERE status = 'new_lead';

-- 2. Swap the CHECK constraint (drop-then-add keeps the same name -> re-runnable).
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_status_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_status_check
    CHECK (status IN ('new', 'in_progress', 'won', 'lost'));

-- 3. Default for brand-new customers.
ALTER TABLE public.customers
  ALTER COLUMN status SET DEFAULT 'new';
