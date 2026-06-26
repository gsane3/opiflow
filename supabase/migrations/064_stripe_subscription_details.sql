-- 064: richer Stripe subscription linkage on business_subscriptions.
--
-- stripe_customer_id + stripe_subscription_id already exist (migration 061); the
-- billing portal now resolves the account by stripe_customer_id (reliable) instead
-- of the user's email (fragile if it differs from the Stripe email). This migration
-- adds the remaining detail fields so the portal + reconciliation have the full
-- picture: which price, when the period ends, and whether a cancel is scheduled.
--
-- All columns are nullable + additive. The Stripe webhook writes them in an
-- ISOLATED, tolerant update, so the application keeps working whether or not this
-- migration has been applied yet (a pre-064 write simply no-ops on the missing
-- columns; the core subscription write — status + stripe ids — already succeeded).
--
-- Idempotent / safe to re-run.

ALTER TABLE public.business_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_price_id      text,
  ADD COLUMN IF NOT EXISTS current_period_end   timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean;
