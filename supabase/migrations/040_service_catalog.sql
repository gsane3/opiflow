-- Migration 040: Service / product catalog (team-shared) + offer line-item link.
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Additive + idempotent. Safe to re-run.
--
-- New feature: each business keeps a shared catalog of services/products (code,
-- name, price, VAT). The catalog feeds offer building — by voice (AI assistant)
-- or as auto-suggestions when typing a line item manually. Shared across the team
-- (business_users membership), so any member sends offers from the same price list.
--
-- offer_items gains an optional catalog_item_id reference. SNAPSHOT RULE (enforced
-- in the API, not the DB): name/unit_price are copied into the offer_item at
-- creation time, so later catalog price edits never change historical offers.

-- 1. service_catalog_items ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_catalog_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code        text,
  name        text        NOT NULL,
  description text,
  category    text,
  unit        text,                      -- e.g. τεμ. / ώρα / m²
  unit_price  numeric     NOT NULL DEFAULT 0,
  vat_rate    numeric     NOT NULL DEFAULT 24,
  active      boolean     NOT NULL DEFAULT true,
  source      text        NOT NULL DEFAULT 'manual',
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT service_catalog_unit_price_nonneg CHECK (unit_price >= 0),
  CONSTRAINT service_catalog_vat_rate_nonneg   CHECK (vat_rate   >= 0),
  CONSTRAINT service_catalog_source_check      CHECK (source IN ('manual', 'ai_chat', 'file_import')),

  -- Required so offer_items can FK on (business_id, id) to enforce tenant safety.
  CONSTRAINT service_catalog_items_business_id_key UNIQUE (business_id, id)
);

-- Unique code per business when a code is provided (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_code_uq
  ON public.service_catalog_items (business_id, lower(code))
  WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_catalog_list_idx
  ON public.service_catalog_items (business_id, active, category);

-- 2. offer_items -> catalog link (composite FK = tenant-safe) ------------------
ALTER TABLE public.offer_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'offer_items_catalog_fk' AND table_schema = 'public' AND table_name = 'offer_items'
  ) THEN
    ALTER TABLE public.offer_items
      ADD CONSTRAINT offer_items_catalog_fk
        FOREIGN KEY (business_id, catalog_item_id)
        REFERENCES public.service_catalog_items(business_id, id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- 3. RLS (mirror offers membership pattern from 007_offers_core) ---------------
ALTER TABLE public.service_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_catalog_select_business_members" ON public.service_catalog_items;
CREATE POLICY "service_catalog_select_business_members"
  ON public.service_catalog_items FOR SELECT TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "service_catalog_insert_business_members" ON public.service_catalog_items;
CREATE POLICY "service_catalog_insert_business_members"
  ON public.service_catalog_items FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

DROP POLICY IF EXISTS "service_catalog_update_business_members" ON public.service_catalog_items;
CREATE POLICY "service_catalog_update_business_members"
  ON public.service_catalog_items FOR UPDATE TO authenticated
  USING (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()))
  WITH CHECK (business_id IN (SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()));

-- DELETE intentionally omitted — soft-delete via active=false.

-- 4. Grants -------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.service_catalog_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_catalog_items TO service_role;
