-- 048_payments.sql — Έργο redesign, payments wave (Stage 7 schema).
--
-- Bank-transfer payments (NOT card/Stripe). The app NEVER moves money: it stores
-- the business's own IBAN, shows it to the customer with a requested amount, the
-- customer self-reports the deposit ("Δήλωσα την κατάθεση" → status 'declared'),
-- and the owner confirms manually (→ 'confirmed', the only authoritative state).
--
-- Additive + safe: nullable bank columns on businesses + a new payment_requests
-- table following the migration-046 tenant pattern (business_id scoping + app-layer
-- isolation; service-role-only RLS). Apply in the Supabase SQL editor BEFORE the
-- Stage-7 API/UI code deploys (no `supabase db push`). Pre-apply, the payments
-- code degrades (reads tolerate the missing table/columns; no existing flow uses them).

-- ── Business bank details (shown on the offer PDF + portal payment card) ──────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS bank_beneficiary text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_iban text;

-- ── Payment requests ──────────────────────────────────────────────────────
-- One row per deposit/balance request the technician sends for a job. `amount`
-- is computed SERVER-SIDE from the offer gross (never trusted from the client).
-- `receiving_account` snapshots the IBAN at request time so historical records +
-- documents stay correct even if the business later edits its bank details.
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  -- Single-column FK + app-layer (business_id + work_folder_id) scoping for tenancy,
  -- matching the 046 pattern (business_id is NOT NULL so a composite SET NULL can't apply).
  work_folder_id uuid REFERENCES public.work_folders (id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.offers (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('deposit', 'balance')),
  pct numeric(5, 2) CHECK (pct IS NULL OR (pct >= 0 AND pct <= 100)),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  -- pending  → request created/sent
  -- declared → customer self-reported the deposit (NOT authoritative)
  -- confirmed→ owner verified the deposit landed (authoritative)
  -- cancelled→ withdrawn
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'declared', 'confirmed', 'cancelled')),
  receiving_account text,
  declared_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Lets other tenant-scoped tables reference (business_id, id) composite-safely.
  CONSTRAINT payment_requests_business_id_key UNIQUE (business_id, id)
);

CREATE INDEX IF NOT EXISTS payment_requests_business_folder_idx
  ON public.payment_requests (business_id, work_folder_id);
CREATE INDEX IF NOT EXISTS payment_requests_business_customer_idx
  ON public.payment_requests (business_id, customer_id);
CREATE INDEX IF NOT EXISTS payment_requests_business_status_idx
  ON public.payment_requests (business_id, status);

-- Service-role-only (matches customer_folder_tokens): RLS ON with NO permissive
-- policy → anon/authenticated are denied; all access goes through service-role
-- server code that ALWAYS filters by business_id. The public declare endpoint is
-- folder-token-validated (SHA-256, fail-closed) like the other /f/[token] writes.
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payment_requests IS
  'Bank-transfer payment requests (deposit/balance). amount computed server-side from offer gross; declared=customer self-report, confirmed=owner-authoritative. App never moves money.';
