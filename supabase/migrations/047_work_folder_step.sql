-- 047_work_folder_step.sql — Έργο redesign, Stage 1.
--
-- Adds the 5-step process tracker (Επαφή · Προσφορά · Πληρωμή · Ραντεβού · Τέλος)
-- to work folders. The index 0..4 maps to WORK_FOLDER_STEPS in
-- src/lib/server/work-folders.ts and drives the Stepper on the technician
-- timeline, the profile project cards, and the public portal.
--
-- Additive + safe: NOT NULL DEFAULT 0 backfills every existing row to step 0
-- (= "Επαφή"). No data is touched beyond the new column.
--
-- ⚠️ Apply this in the Supabase SQL editor BEFORE merging/deploying the Stage-1
--    code (same discipline as 046). The code selects `step`; until the column
--    exists the authenticated folder routes return their normal error state and
--    the public /f/[token] loader fail-closes — no crash, but folders won't load.
--    Project rule: apply manually here, do NOT `supabase db push`.

ALTER TABLE public.work_folders
  ADD COLUMN IF NOT EXISTS step smallint NOT NULL DEFAULT 0
  CHECK (step >= 0 AND step <= 4);

COMMENT ON COLUMN public.work_folders.step IS
  'Process step 0..4 (Επαφή/Προσφορά/Πληρωμή/Ραντεβού/Τέλος). See WORK_FOLDER_STEPS.';
