-- Migration 037: Appointment duration (start/end) for the day-view calendar.
--
-- Applied MANUALLY via the Supabase SQL editor (do not `supabase db push`).
-- Additive + idempotent. Safe to re-run.
--
-- Appointments are public.tasks rows with type IN ('book_appointment','visit_customer').
-- Today they carry only due_date (date) + due_time (HH:MM text) — no start/end, so the
-- redesign's day-view calendar cannot place them in time-slots with a duration.
-- This adds start_at / end_at (timestamptz) and backfills start_at from (due_date+due_time).
-- due_date / due_time are kept for backward-compat (existing readers/writers still work).

-- 1. tasks: start_at / end_at -------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_at   timestamptz;

-- end must be after start when both present (idempotent add).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_end_after_start' AND table_schema = 'public' AND table_name = 'tasks'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_end_after_start CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at);
  END IF;
END $$;

-- Backfill start_at from (due_date + due_time) for appointment-type tasks only.
UPDATE public.tasks
   SET start_at = (due_date::text || ' ' || COALESCE(due_time, '09:00') || ':00')::timestamptz
 WHERE type IN ('book_appointment', 'visit_customer')
   AND start_at IS NULL
   AND due_date IS NOT NULL;

-- Partial index powering the day-view calendar popup (business + start, appts only).
CREATE INDEX IF NOT EXISTS tasks_business_start_appt_idx
  ON public.tasks (business_id, start_at)
  WHERE type IN ('book_appointment', 'visit_customer');

-- 2. appointment_response_tokens: allow the customer to propose a slot w/ duration
ALTER TABLE public.appointment_response_tokens
  ADD COLUMN IF NOT EXISTS requested_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS requested_end_at   timestamptz;
