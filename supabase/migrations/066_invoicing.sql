-- 066_invoicing.sql — AADE / myDATA e-invoicing (optional, opt-in per tenant).
--
-- Lets a technician (the business) issue an OFFICIAL invoice/receipt (τιμολόγιο /
-- απόδειξη παροχής υπηρεσιών) to THEIR end-customer, transmitted to myDATA via an
-- AADE-accredited provider (SBZ) acting as Opiflow's partner. The provider uses ONE
-- partner credential pair (set in env: SBZ_API_*) and identifies each issuer by VAT
-- (issuervat) per document — so per-tenant we store only the issuer's ΑΦΜ + the
-- onboarding/activation state, NOT a secret.
--
-- Additive + safe (zero-Live): two new tables, nothing references them until the
-- invoicing module ships. Both are service-role-only (RLS ON, no policies) like
-- payment_requests (048) and outbox_events (063). Apply in the Supabase SQL editor
-- BEFORE the invoicing code deploys (no `supabase db push`). Pre-apply, all
-- invoicing code degrades (env-gated → 503 invoicing_not_configured; reads tolerate
-- the missing tables).

-- ── Per-tenant invoicing settings (one row per business) ─────────────────────
-- enabled/onboarding gate the whole feature for that tenant. The issuer ΑΦΜ falls
-- back to businesses.vat_number (001) when issuer_vat is NULL.
CREATE TABLE IF NOT EXISTS public.business_invoicing_settings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL UNIQUE REFERENCES public.businesses (id) ON DELETE CASCADE,
  enabled             boolean     NOT NULL DEFAULT false,
  provider            text        NOT NULL DEFAULT 'sbz',
  issuer_vat          text,                                  -- override; else businesses.vat_number
  issuer_branch       integer     NOT NULL DEFAULT 0,        -- AADE branch (0 = head office)
  invoice_series      text,                                  -- e.g. 'A'
  auto_issue_on_payment boolean   NOT NULL DEFAULT false,    -- issue automatically when a payment is confirmed
  default_income_classification text,                        -- E3 code, e.g. 'E3_561_001'
  -- not_started → link_sent → gsis_authorized → active
  onboarding_status   text        NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'link_sent', 'gsis_authorized', 'active')),
  gsis_authorized_at  timestamptz,
  activated_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Issued documents ─────────────────────────────────────────────────────────
-- One row per myDATA document. Amounts: total is GROSS (VAT-inclusive, matching the
-- offer/payment gross); net + vat are split at issue time. mark/uid/authentication_code/
-- qr_url are the canonical myDATA identifiers returned on success. dedup_key makes
-- auto-issue idempotent (e.g. 'pay:<payment_request_id>').
CREATE TABLE IF NOT EXISTS public.invoices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid        NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  customer_id         uuid        REFERENCES public.customers (id) ON DELETE SET NULL,
  work_folder_id      uuid        REFERENCES public.work_folders (id) ON DELETE SET NULL,
  offer_id            uuid        REFERENCES public.offers (id) ON DELETE SET NULL,
  payment_request_id  uuid        REFERENCES public.payment_requests (id) ON DELETE SET NULL,
  provider            text        NOT NULL DEFAULT 'sbz',
  -- myDATA invoiceType: 2.1 service invoice (B2B), 11.1/11.2 retail (B2C), 1.1 sales,
  -- 5.1/5.2 credit notes. Stored as text to follow the AADE enumeration verbatim.
  invoice_type        text        NOT NULL,
  series              text,
  aa                  text,                                  -- serial within series
  issue_date          date        NOT NULL DEFAULT current_date,
  counterparty_vat    text,                                  -- end-customer ΑΦΜ (B2B); NULL for B2C retail
  counterparty_name   text,
  currency            text        NOT NULL DEFAULT 'EUR',
  net_amount          numeric(12, 2) NOT NULL DEFAULT 0,
  vat_amount          numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount        numeric(12, 2) NOT NULL DEFAULT 0,
  line_items          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  classification      jsonb,                                 -- E3 / VAT classification payload
  -- draft → submitting → issued | failed ; cancelled after a credit note
  status              text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitting', 'issued', 'failed', 'cancelled')),
  mark                text,                                  -- ΜΑΡΚ (Unique Registration Number)
  uid                 text,                                  -- invoiceUid (40 chars)
  authentication_code text,
  qr_url              text,
  cancellation_mark   text,                                  -- ΜΑΡΚ of the cancelling/credit doc
  dedup_key           text,                                  -- idempotency, e.g. 'pay:<payment_request_id>'
  provider_request    jsonb,
  provider_response   jsonb,
  error               text,
  issued_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Composite-safe reference target for tenant-scoped joins.
  CONSTRAINT invoices_business_id_key UNIQUE (business_id, id)
);

CREATE INDEX IF NOT EXISTS invoices_business_status_idx
  ON public.invoices (business_id, status);
CREATE INDEX IF NOT EXISTS invoices_business_customer_idx
  ON public.invoices (business_id, customer_id);
CREATE INDEX IF NOT EXISTS invoices_business_folder_idx
  ON public.invoices (business_id, work_folder_id);
-- Idempotency: at most one invoice per (business_id, dedup_key) when a key is given.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_dedup_uidx
  ON public.invoices (business_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled, no public policies. Service role only
-- (matches payment_requests / outbox_events). All access is server-side code
-- that ALWAYS filters by business_id via tenantDb.
-- ---------------------------------------------------------------------------
ALTER TABLE public.business_invoicing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                    ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.business_invoicing_settings FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.business_invoicing_settings FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.business_invoicing_settings FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_invoicing_settings TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.invoices FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.invoices FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.invoices FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoices TO service_role;

COMMENT ON TABLE public.invoices IS
  'AADE/myDATA issued documents (via accredited provider). total_amount is GROSS; net+vat split at issue. mark/uid/qr_url returned by myDATA. Service-role-only.';

-- Migration tracking (065 convention).
INSERT INTO public.schema_migrations (version, filename)
VALUES ('066', '066_invoicing.sql')
ON CONFLICT (version) DO NOTHING;
