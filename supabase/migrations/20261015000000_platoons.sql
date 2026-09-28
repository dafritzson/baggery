-- Platoons and batting order, for the draft table's xBags and Spot, its platoon chips and the
-- player popup's Round matchups. sync-pool fills the pool's and teams' columns from each postseason
-- team's regular-season lineups; poll-games fills mlb_probables from the postseason schedule.
-- The app loads these only when a draft table or player popup needs them, not with the season.

-- Batting side (L, R or S), and his record against each hand's starters (core/platoon.ts):
-- { "L": { "games", "starts", "weighted": HandSplit, "line": Counts, "opsPlus" }, "R": … }.
alter table public.season_player_pool
  add column bat_side text check (bat_side in ('L', 'R', 'S')),
  add column platoon jsonb;

-- The team's likely postseason rotation, in turn order: [{ "pitcherId", "name", "hand" }].
alter table public.season_mlb_teams
  add column rotation jsonb;

-- Announced starters of postseason games. Its own table, not mlb_games columns: every mlb_games
-- change is broadcast whole to every open app, many times a live game.
create table public.mlb_probables (
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  mlb_team_id integer not null references public.mlb_teams (id),
  pitcher_id integer not null,
  pitcher_name text not null,
  hand text check (hand in ('L', 'R')),
  primary key (game_pk, mlb_team_id)
);

alter table public.mlb_probables enable row level security;
create policy "signed-in users can read" on public.mlb_probables for select to authenticated using (true);
grant select on public.mlb_probables to authenticated;
