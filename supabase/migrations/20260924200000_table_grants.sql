-- Hosted Supabase projects no longer grant table privileges to the API roles by default
-- (local Supabase still does), so grant exactly what the app needs. Revoking first makes
-- local behave like hosted, so tests catch missing grants.
--
-- Signed-in users read everything (row level security still applies). All writes go
-- through Edge Functions or security-definer RPCs, except editing your own display name.
-- Signed-out visitors get nothing.

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Tables added by future migrations get the same default.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public grant select on tables to authenticated;
