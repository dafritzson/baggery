-- Baggery initial schema. See docs/PLAN.md for the data model overview and
-- docs/RULES.md for the rules these constraints enforce.

-- ---------------------------------------------------------------------------
-- People and leagues
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile, named after their email until they change it.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create type public.league_role as enum ('commissioner', 'member');

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.league_role not null default 'member',
  primary key (league_id, user_id)
);

create type public.season_status as enum ('setup', 'active', 'complete');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  year smallint not null,
  status public.season_status not null default 'setup',
  -- Teams still alive after fantasy rounds 1, 2, 3. 7 teams → {5,3,1}.
  survivors_after_round smallint[] not null default '{5,3,1}',
  created_at timestamptz not null default now(),
  unique (league_id, year)
);

create table public.fantasy_teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  manager_name text not null,
  -- Null for historical seasons or managers who haven't signed up yet.
  user_id uuid references auth.users (id) on delete set null,
  name text,
  autodraft boolean not null default false,
  eliminated_after_round smallint check (eliminated_after_round between 1 and 3),
  created_at timestamptz not null default now(),
  unique (season_id, manager_name)
);

create unique index fantasy_teams_one_per_user
  on public.fantasy_teams (season_id, user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- MLB mirror (written only by the stats sync)
-- ---------------------------------------------------------------------------

create table public.mlb_teams (
  id integer primary key, -- MLB team id
  name text not null,
  abbreviation text not null,
  league text check (league in ('AL', 'NL'))
);

create table public.mlb_players (
  id integer primary key, -- MLB person id
  full_name text not null,
  primary_position text,
  birth_date date,
  updated_at timestamptz not null default now()
);

create type public.game_type as enum ('F', 'D', 'L', 'W');

create table public.mlb_games (
  game_pk integer primary key,
  season_year smallint not null,
  game_type public.game_type not null,
  start_time timestamptz not null,
  -- MLB abstractGameState: Preview | Live | Final
  status text not null,
  detailed_state text,
  home_team_id integer not null references public.mlb_teams (id),
  away_team_id integer not null references public.mlb_teams (id),
  home_score smallint,
  away_score smallint,
  updated_at timestamptz not null default now()
);

create index mlb_games_year_type on public.mlb_games (season_year, game_type);

create table public.player_game_stats (
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  mlb_player_id integer not null references public.mlb_players (id),
  mlb_team_id integer not null references public.mlb_teams (id),
  ab smallint not null default 0,
  h smallint not null default 0,
  doubles smallint not null default 0,
  triples smallint not null default 0,
  hr smallint not null default 0,
  bb smallint not null default 0,
  hbp smallint not null default 0,
  sf smallint not null default 0,
  tb smallint not null default 0,
  r smallint not null default 0,
  rbi smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_pk, mlb_player_id)
);

create index player_game_stats_player on public.player_game_stats (mlb_player_id);

-- MLB teams in a season's postseason.
create table public.season_mlb_teams (
  season_id uuid not null references public.seasons (id) on delete cascade,
  mlb_team_id integer not null references public.mlb_teams (id),
  seed smallint,
  eliminated boolean not null default false,
  primary key (season_id, mlb_team_id)
);

-- Who is draftable in a season. Rebuilt from MLB rosters before each draft.
create table public.season_player_pool (
  season_id uuid not null references public.seasons (id) on delete cascade,
  mlb_player_id integer not null references public.mlb_players (id),
  mlb_team_id integer not null references public.mlb_teams (id),
  regular_season_tb smallint not null default 0,
  on_postseason_roster boolean not null default false,
  primary key (season_id, mlb_player_id)
);

-- ---------------------------------------------------------------------------
-- Drafts and rosters
-- ---------------------------------------------------------------------------

create type public.draft_kind as enum ('initial', 'redraft');
create type public.draft_status as enum ('scheduled', 'live', 'complete');

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  number smallint not null check (number between 1 and 4),
  kind public.draft_kind not null,
  -- The fantasy round this draft sets rosters for (drafts 1–2 → 1, 3 → 2, 4 → 3).
  fantasy_round smallint not null check (fantasy_round between 1 and 3),
  before_game_type public.game_type not null,
  -- Fantasy team ids in first-round pick order. Set when the draft goes live.
  pick_order uuid[] not null default '{}',
  rounds smallint not null default 4,
  status public.draft_status not null default 'scheduled',
  -- First pitch of the next series. Picks lock here, and roster changes take effect here.
  locks_at timestamptz,
  created_at timestamptz not null default now(),
  unique (season_id, number)
);

create type public.draft_action_type as enum ('pick', 'yield');

create table public.draft_actions (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.drafts (id) on delete cascade,
  -- 0-based position among this draft's actions. Unique, so two clients can't both
  -- make the same pick.
  action_number integer not null,
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  type public.draft_action_type not null,
  add_player_id integer references public.mlb_players (id),
  drop_player_id integer references public.mlb_players (id),
  is_auto boolean not null default false,
  made_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (draft_id, action_number),
  check (
    (type = 'yield' and add_player_id is null and drop_player_id is null)
    or (type = 'pick' and add_player_id is not null)
  )
);

-- A player's time on a fantasy roster: [from_at, to_at). Stats count for games whose
-- start_time falls inside a spell.
create table public.roster_spells (
  id bigint generated always as identity primary key,
  season_id uuid not null references public.seasons (id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  mlb_player_id integer not null references public.mlb_players (id),
  from_at timestamptz not null,
  to_at timestamptz,
  added_by_draft_id uuid references public.drafts (id) on delete set null,
  dropped_by_draft_id uuid references public.drafts (id) on delete set null,
  -- One roster, ever, per season.
  unique (season_id, mlb_player_id),
  check (to_at is null or to_at >= from_at)
);

create index roster_spells_team on public.roster_spells (fantasy_team_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- MVP: signed-in users can read everything. All writes go through Edge Functions
-- using the service role, which bypasses RLS, except editing your own profile.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'leagues', 'league_members', 'seasons', 'fantasy_teams', 'mlb_teams',
    'mlb_players', 'mlb_games', 'player_game_stats', 'season_mlb_teams',
    'season_player_pool', 'drafts', 'draft_actions', 'roster_spells'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "signed-in users can read" on public.%I for select to authenticated using (true)', t
    );
  end loop;
end;
$$;

create policy "users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Live updates for the draft room, rosters and scores.
alter publication supabase_realtime add table
  public.drafts, public.draft_actions, public.roster_spells, public.mlb_games, public.player_game_stats;
