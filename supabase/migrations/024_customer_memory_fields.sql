-- Migration 024: Customer memory fields.
-- Adds five nullable columns to public.customers for the manual memory layer.
-- These fields are for human-entered notes and status.
-- AI must remain review-first: no automatic writes to these fields from any pipeline.
--
-- All columns are nullable text or timestamptz with no DEFAULT value.
-- ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run on a live table.
-- No indexes, no RLS changes, no grant changes needed.
-- The existing UPDATE policy in 003_crm_core.sql already covers new columns.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS status_summary    text,
  ADD COLUMN IF NOT EXISTS business_notes    text,
  ADD COLUMN IF NOT EXISTS personal_notes    text,
  ADD COLUMN IF NOT EXISTS next_best_action  text,
  ADD COLUMN IF NOT EXISTS memory_updated_at timestamptz;
