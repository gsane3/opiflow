-- 045_realtime_timeline.sql
-- Enable Supabase Realtime on the customer-timeline tables so the customer chat
-- (MessengerTimeline) updates LIVE — inbound calls/messages, offer accept (its
-- audit communications row), intake submissions, and photo uploads pop in without
-- a manual refresh.
--
-- Realtime respects RLS, so each owner only receives Postgres-change events for
-- their own rows (the existing business-scoped SELECT policies apply). REPLICA
-- IDENTITY FULL ensures UPDATE/DELETE events carry enough of the row for those
-- RLS checks. Idempotent: re-running is a no-op.
--
-- Apply manually in the Supabase SQL editor (this project does not db push).

do $$
declare
  t text;
  tbls text[] := array[
    'communications',
    'offers',
    'tasks',
    'customer_intake_tokens',
    'customer_upload_sessions'
  ];
begin
  foreach t in array tbls loop
    -- Deliver full rows so RLS can evaluate UPDATE/DELETE events.
    execute format('alter table public.%I replica identity full', t);

    -- Add to the realtime publication only if not already a member.
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
