-- Migration 068 — Stripe invoicing add-on entitlement (per-tenant monthly billing).
-- Apply manually via the Supabase SQL editor (live project oluhmztfimmgmbxoioea).
--
-- The optional AADE/myDATA invoicing feature is billed as a SEPARATE monthly Stripe
-- subscription (price STRIPE_INVOICING_PRICE_ID), distinct from the main plan
-- subscription (business_subscriptions). We track that add-on's state HERE, on the
-- per-tenant invoicing settings row — so it never collides with the main plan
-- (different table, both keyed by business_id). The Stripe webhook writes these on
-- checkout.session.completed / customer.subscription.updated|deleted events that
-- carry metadata.kind = 'invoicing_addon'.
--
-- Additive + tolerant: these columns are read/written via ISOLATED helpers
-- (getInvoicingAddonStatus / applyAddonSubscription) that degrade if the migration
-- isn't applied yet — they are NOT in the core SETTINGS_COLUMNS select (which feeds
-- the issuance gate), so a pending migration can never break invoice issuance.

ALTER TABLE public.business_invoicing_settings
  ADD COLUMN IF NOT EXISTS addon_status text NOT NULL DEFAULT 'none'
    CHECK (addon_status IN ('none', 'active', 'cancelled')),
  ADD COLUMN IF NOT EXISTS addon_subscription_id text,
  ADD COLUMN IF NOT EXISTS addon_current_period_end timestamptz;

-- Migration tracking (065 convention).
INSERT INTO public.schema_migrations (version, filename)
VALUES ('068', '068_invoicing_addon.sql')
ON CONFLICT (version) DO NOTHING;
