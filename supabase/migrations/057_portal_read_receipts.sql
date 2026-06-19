-- 057_portal_read_receipts.sql
--
-- Read receipts for owner→customer messages shown in the public shared-link
-- portal, plus a rolling "last visited" timestamp on the folder token used by
-- the 24h unread-message reminder cron.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so it is
-- safe to re-run. Apply MANUALLY in the Supabase SQL editor (live project).
--
-- All reads/writes of these columns in the app are TOLERANT: until this
-- migration is applied, read receipts simply don't show and the unread cron
-- no-ops — nothing breaks.

-- When the customer opens the chat thread in the portal, the owner's outbound
-- messages for that folder get read_at = now().
alter table public.communications
  add column if not exists read_at timestamptz;

-- Rolled forward each time the customer views the portal chat. Lets the cron
-- tell "never opened / not opened recently" apart from "just looked".
alter table public.customer_folder_tokens
  add column if not exists last_visited_at timestamptz;

-- Fast "unread outbound messages in this folder" lookups for the reminder cron.
create index if not exists communications_unread_outbound_idx
  on public.communications (business_id, work_folder_id)
  where read_at is null and direction = 'outbound';
