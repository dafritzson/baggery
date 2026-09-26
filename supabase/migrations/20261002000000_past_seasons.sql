-- Past seasons (2020–2025), imported from the league's old Google Sheets by the import-season
-- Edge Function. See .claude/skills/import-season/SKILL.md.

-- Everyone who has managed a team in the league, by the first name the league has always used.
-- Past seasons' teams point here. Linking a manager to an account (user_id) makes that person's
-- past teams theirs, including in seasons imported later.
create table public.league_managers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  user_id uuid references auth.users (id) on delete set null,
  unique (league_id, name)
);

create unique index league_managers_one_per_user
  on public.league_managers (league_id, user_id) where user_id is not null;

alter table public.league_managers enable row level security;
create policy "signed-in users can read" on public.league_managers for select to authenticated using (true);

alter table public.fantasy_teams
  add column manager_id uuid references public.league_managers (id) on delete set null;

-- When a season was imported. Only imported seasons can be imported again (replacing them), so
-- an import can never overwrite a season played in the app.
alter table public.seasons add column imported_at timestamptz;
