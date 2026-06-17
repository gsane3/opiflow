-- 050: durable per-folder customer portal URL.
--
-- Lets every project-update notification (γ) — and the «preview» eye — link the
-- customer to the SAME /f/[token] page instead of minting a new link each time.
-- The token itself stays hash-only in customer_folder_tokens; this column stores
-- ONLY the already-customer-facing URL (the same string we send via SMS), and is
-- service-role / RLS protected exactly like the rest of work_folders.
--
-- Tolerant rollout: the app degrades gracefully when this column is absent
-- (notify-folder-update mints a fresh token instead), so applying this migration
-- is non-breaking and can happen any time.

ALTER TABLE public.work_folders
  ADD COLUMN IF NOT EXISTS portal_url text;
