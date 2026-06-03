-- yorgos.ai Performance Indexes
-- Adds covering/composite indexes on the hot filter columns used by the app's
-- list and timeline queries. All statements use CREATE INDEX IF NOT EXISTS and
-- are therefore idempotent and safe to re-run.
--
-- Only columns and tables that already exist (created in earlier migrations) are
-- indexed here:
--   * customers              (003_crm_core.sql)
--   * communications         (003_crm_core.sql)
--   * tasks                  (003_crm_core.sql)
--   * offers                 (007_offers_core.sql)
--   * customer_intake_tokens (005_customer_intake_tokens.sql)
--   * offer_response_tokens  (008_offer_response_tokens.sql)
--   * appointment_response_tokens (009_appointment_response_tokens.sql)
--
-- Note on token_hash indexes:
-- Each token table already has a UNIQUE index on (token_hash) created in its
-- original migration (e.g. customer_intake_tokens_token_hash_unique). Those
-- unique indexes already serve point lookups by token_hash, so no additional
-- token_hash index is required or created here. The unique constraints are the
-- canonical token_hash lookup path. See the per-table migrations above.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
-- Tenant-scoped list queries filter by business_id and order by created_at DESC.

CREATE INDEX IF NOT EXISTS customers_business_id_perf_idx
  ON public.customers (business_id);

CREATE INDEX IF NOT EXISTS customers_business_created_at_desc_idx
  ON public.customers (business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- communications
-- ---------------------------------------------------------------------------
-- Customer timeline reads the latest communications for a customer within a
-- business, newest first.

CREATE INDEX IF NOT EXISTS communications_business_customer_created_desc_idx
  ON public.communications (business_id, customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
-- Task lists filter by business_id + status and sort/scan by due_date.

CREATE INDEX IF NOT EXISTS tasks_business_status_due_date_idx
  ON public.tasks (business_id, status, due_date);

-- ---------------------------------------------------------------------------
-- offers
-- ---------------------------------------------------------------------------
-- Offer lists filter by business_id + status.

CREATE INDEX IF NOT EXISTS offers_business_status_idx
  ON public.offers (business_id, status);
