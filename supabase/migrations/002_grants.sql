-- yorgos.ai Backend Phase 1 Data API Grants
--
-- These grants are required when Supabase project/table exposure is not automatic.
-- RLS still controls authenticated user access.
-- service_role is server-only and bypasses RLS, but grants are still explicit for API access.

grant usage on schema public to authenticated;
grant usage on schema public to service_role;

grant select, insert on table public.businesses to authenticated;
grant select, insert on table public.business_users to authenticated;

grant select, insert, update, delete on table public.businesses to service_role;
grant select, insert, update, delete on table public.business_users to service_role;
