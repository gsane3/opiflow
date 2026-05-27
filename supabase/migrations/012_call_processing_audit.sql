-- Track D: Call Processing Audit Fields
-- Adds nullable lifecycle timestamps and an error code column to communications.
-- These fields let the pbx-recording pipeline record when each processing stage
-- completed and confirm that audio/transcript were never persisted.
--
-- Audio and transcript are held in RAM only during the recording request.
-- Neither is written to any storage or database column.
-- The discarded_at timestamps record the moment the pipeline confirmed this.
--
-- All columns are nullable. Existing rows are not backfilled.
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout.
-- No RLS changes, no grant changes, no indexes in this slice.

-- recording_received_at: set when the pbx-recording endpoint accepts the audio upload.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS recording_received_at timestamptz;

-- transcription_started_at: set immediately before audio is sent to the transcription API.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS transcription_started_at timestamptz;

-- brief_created_at: set after the AI brief text is returned and validated.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS brief_created_at timestamptz;

-- audio_discarded_at: set after the brief is saved to the database.
-- Confirms that the audio file was processed and not persisted anywhere.
-- Audio arrived in RAM only and was discarded when the request handler returned.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS audio_discarded_at timestamptz;

-- transcript_discarded_at: set alongside audio_discarded_at after brief is saved.
-- Confirms that transcript text was used only for brief generation and not retained.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS transcript_discarded_at timestamptz;

-- processing_failed_at: set on any terminal failure in the recording pipeline.
-- Null means the pipeline either succeeded or has not yet run for this row.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS processing_failed_at timestamptz;

-- processing_error_code: short machine-readable error category, set alongside
-- processing_failed_at. Contains only safe non-secret strings such as
-- 'transcription_failed', 'brief_generation_failed', or 'communication_not_found'.
-- Never contains secrets, tokens, API responses, or caller data.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS processing_error_code text;
