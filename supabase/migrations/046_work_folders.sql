-- 046_work_folders.sql — Φάκελος εργασίας (Work Folder) MVP, schema only (WF-0).
--
-- A work folder is an OPTIONAL per-job grouping under an existing customer
-- (e.g. customer "Γιώργος Τσίπος" → folder "Τοποθέτηση κλιματιστικού"). It is a
-- SECOND, optional grouping axis layered beside the existing customer hub — it
-- does not replace customer_id anywhere.
--
-- WF-0 provisions the schema ONLY. It is DORMANT: no API route, component, or
-- type references these tables/columns yet, so applying it changes NO product
-- behavior. Folder linking starts when WF-1+ ships.
--
-- Design rules honored here:
--   * Additive only. New tables + NULLABLE work_folder_id columns. No backfill,
--     no NOT NULL on work_folder_id, no changes to existing columns/rows.
--   * Existing rows keep working: work_folder_id defaults to NULL (= unfiled),
--     which every current insert path already produces.
--   * work_folder_id links use a SINGLE-column FK with ON DELETE SET NULL — the
--     same pattern the codebase already uses for customer_id (e.g.
--     offers.customer_id → customers(id) ON DELETE SET NULL, 007). A *composite*
--     (business_id, work_folder_id) FK with SET NULL is NOT used because
--     business_id is NOT NULL on these tables and SET NULL would try to null it.
--     Tenant safety for these links is enforced at the API layer (every write is
--     business_id-scoped) + RLS, identical to how customer_id links work today.
--   * The folder TOKEN uses a tenant-safe COMPOSITE FK with ON DELETE CASCADE
--     (mirrors offer_response_tokens.offer_id → offers(business_id, id)), so a
--     token cannot reference another tenant's folder and dies with its folder.
--   * RLS via the existing business_users membership pattern (003/007/028).
--   * public.jobs (030) is the dormant async queue and is intentionally NOT used.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY. Safe to run more than once.
-- Apply manually in the Supabase SQL editor (project convention — no db push).
-- updated_at is API-managed (no triggers), consistent with the CRM tables.

-- ===========================================================================
-- 1. work_folders — the parent grouping entity
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.work_folders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- A folder always belongs to ONE existing customer (confirmed product rule).
  -- CASCADE: deleting a customer removes their folders (GDPR delete stays clean).
  customer_id uuid        NOT NULL REFERENCES public.customers(id)  ON DELETE CASCADE,
  title       text        NOT NULL,
  status      text        NOT NULL DEFAULT 'open',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT work_folders_status_check
    CHECK (status IN ('open', 'in_progress', 'done', 'archived')),

  -- Required so customer_folder_tokens can FK on (business_id, id) to stay
  -- tenant-safe (same trick as offers_business_id_key in 007).
  CONSTRAINT work_folders_business_id_key UNIQUE (business_id, id)
);

CREATE INDEX IF NOT EXISTS work_folders_business_customer_status_idx
  ON public.work_folders (business_id, customer_id, status);

CREATE INDEX IF NOT EXISTS work_folders_business_status_idx
  ON public.work_folders (business_id, status);

ALTER TABLE public.work_folders ENABLE ROW LEVEL SECURITY;

-- RLS: any business_users member of the owning business. Mirrors offers (007).
DROP POLICY IF EXISTS "work_folders_select_business_members" ON public.work_folders;
CREATE POLICY "work_folders_select_business_members"
  ON public.work_folders
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work_folders_insert_business_members" ON public.work_folders;
CREATE POLICY "work_folders_insert_business_members"
  ON public.work_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "work_folders_update_business_members" ON public.work_folders;
CREATE POLICY "work_folders_update_business_members"
  ON public.work_folders
  FOR UPDATE
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

-- DELETE policy intentionally omitted, consistent with the other CRM tables.

GRANT SELECT, INSERT, UPDATE         ON public.work_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_folders TO service_role;

-- ===========================================================================
-- 2. customer_folder_tokens — the public link for ONE folder
-- ===========================================================================
-- Folder-scoped (one public link = one job). Stores only the SHA-256 token
-- hash, never the raw token. Service-role-only, like the other token tables
-- (005/025): the public /f/[token] page reads it through a trusted server route.

CREATE TABLE IF NOT EXISTS public.customer_folder_tokens (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  work_folder_id uuid        NOT NULL,
  token_hash     text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  sent_channel   text,
  sent_to_phone  text,
  expires_at     timestamptz NOT NULL,
  opened_at      timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_folder_tokens_status_check
    CHECK (status IN ('pending', 'sent', 'opened', 'expired', 'revoked')),

  CONSTRAINT customer_folder_tokens_sent_channel_check
    CHECK (sent_channel IS NULL OR sent_channel IN ('viber', 'sms', 'email', 'manual')),

  -- Tenant-safe composite FK: the token can only point at a folder in the SAME
  -- business, and is deleted when its folder is deleted.
  CONSTRAINT customer_folder_tokens_business_folder_fk
    FOREIGN KEY (business_id, work_folder_id)
    REFERENCES public.work_folders (business_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_folder_tokens_token_hash_unique
  ON public.customer_folder_tokens (token_hash);

CREATE INDEX IF NOT EXISTS customer_folder_tokens_business_folder_idx
  ON public.customer_folder_tokens (business_id, work_folder_id);

CREATE INDEX IF NOT EXISTS customer_folder_tokens_status_expires_idx
  ON public.customer_folder_tokens (status, expires_at);

CREATE INDEX IF NOT EXISTS customer_folder_tokens_created_idx
  ON public.customer_folder_tokens (created_at);

ALTER TABLE public.customer_folder_tokens ENABLE ROW LEVEL SECURITY;

-- No authenticated or anon policies by design — access only via service_role
-- server routes (identical to customer_intake_tokens / customer_upload_tokens).
REVOKE ALL PRIVILEGES ON TABLE public.customer_folder_tokens FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.customer_folder_tokens FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_folder_tokens FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_folder_tokens TO service_role;

-- ===========================================================================
-- 3. Nullable work_folder_id link columns on the MVP entity set
-- ===========================================================================
-- Single-column FK → work_folders(id) ON DELETE SET NULL (the customer_id
-- precedent). NULL = unfiled = current behavior. Adding the column with an
-- inline FK keeps the whole statement idempotent under ADD COLUMN IF NOT EXISTS:
-- on a re-run the column already exists and the statement is skipped.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS work_folder_id uuid
  REFERENCES public.work_folders(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS work_folder_id uuid
  REFERENCES public.work_folders(id) ON DELETE SET NULL;

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS work_folder_id uuid
  REFERENCES public.work_folders(id) ON DELETE SET NULL;

ALTER TABLE public.customer_intake_tokens
  ADD COLUMN IF NOT EXISTS work_folder_id uuid
  REFERENCES public.work_folders(id) ON DELETE SET NULL;

ALTER TABLE public.customer_upload_tokens
  ADD COLUMN IF NOT EXISTS work_folder_id uuid
  REFERENCES public.work_folders(id) ON DELETE SET NULL;

-- Partial indexes: only the (eventually) filed rows are indexed, so reads like
-- "list this folder's offers" are fast while the ~all-NULL column stays cheap.
CREATE INDEX IF NOT EXISTS offers_business_work_folder_idx
  ON public.offers (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_business_work_folder_idx
  ON public.tasks (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS communications_business_work_folder_idx
  ON public.communications (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_intake_tokens_business_work_folder_idx
  ON public.customer_intake_tokens (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_upload_tokens_business_work_folder_idx
  ON public.customer_upload_tokens (business_id, work_folder_id)
  WHERE work_folder_id IS NOT NULL;

-- ===========================================================================
-- End of 046. Dormant until WF-1+ API/UI references these objects.
-- ===========================================================================
