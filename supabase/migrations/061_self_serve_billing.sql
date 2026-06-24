-- 061: Self-serve monetization — pay-at-signup entitlement model + Stripe linkage
--
-- Enables the pay-immediately-at-signup flow:
--   * New public signups get status 'pending_payment' (NOT entitled) and must
--     complete Stripe Checkout before using the product. The Stripe webhook flips
--     them to 'active'.
--   * 'past_due' supports dunning (a failed renewal) without an immediate cancel.
--   * Existing manual/pilot accounts ('pending_manual_review'/'trialing') are
--     UNCHANGED and stay entitled — see src/lib/billing/entitlement.ts.
--
-- The application code degrades gracefully until this migration is applied: a
-- signup that can't write 'pending_payment' (CHECK violation) falls back to the
-- legacy 'pending_manual_review', so the product keeps working pre-migration.
--
-- Idempotent / safe to re-run.

-- 1) Dedicated Stripe id columns (billing_provider/billing_ref already exist from
--    017; these make the linkage explicit for the billing portal + reconciliation).
ALTER TABLE public.business_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- 2) Extend the status CHECK with the two new states.
ALTER TABLE public.business_subscriptions
  DROP CONSTRAINT IF EXISTS business_subscriptions_status_check;

ALTER TABLE public.business_subscriptions
  ADD CONSTRAINT business_subscriptions_status_check
  CHECK (status IN (
    'pending_manual_review',
    'pending_payment',
    'trialing',
    'active',
    'past_due',
    'cancelled'
  ));
