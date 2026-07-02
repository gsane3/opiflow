-- 069: seed the Base/Premium ANNUAL tier plans (s44 pricing decision — see
-- src/lib/billing/tiers.ts for the presentation source of truth). The webhook
-- and signup write plan_key='base'/'premium' once the per-tier Stripe prices
-- (STRIPE_PRICE_ID_BASE / STRIPE_PRICE_ID_PREMIUM) are configured; both code
-- paths fall back to 'pro' if this migration is not applied yet.
--
-- Apply manually via the Supabase SQL editor (project convention).

INSERT INTO public.package_plans (plan_key, name, sort_order)
VALUES
  ('base',    'Opiflow Base',    4),
  ('premium', 'Opiflow Premium', 5)
ON CONFLICT (plan_key) DO NOTHING;

-- Self-record (migration 065 tracking).
INSERT INTO public.schema_migrations (version, filename)
VALUES ('069', '069_base_premium_plans.sql')
ON CONFLICT (version) DO NOTHING;
