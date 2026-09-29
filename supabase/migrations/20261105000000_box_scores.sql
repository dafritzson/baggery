-- Box scores on the Games tab: tapping a game shows every hitter's line, in batting order, with
-- the line score by inning, or both starting lineups before first pitch. poll-games fills all of
-- this from the box score, linescore and schedule it already reads.

-- Where he batted ("300": third, 301 replaced him, and so on), the positions he played ("PH-3B")
-- and his strikeouts. A strikeout always changes AB too, so these send no extra broadcasts.
alter table public.player_game_stats
  add column batting_order smallint,
  add column position text,
  add column so smallint;

-- Runs by inning and each team's runs, hits and errors, kept small because every mlb_games
-- change is broadcast whole to every open app: { "innings": [[away, home], …], "away": [r, h, e],
-- "home": [r, h, e] }, with null for a half inning not played. The scores load doesn't select it;
-- the box score loads it when opened.
alter table public.mlb_games
  add column linescore jsonb;

-- Each team's posted starting lineup, leadoff first: [{ "id", "name", "pos" }]. Its own table,
-- not mlb_games columns, so it isn't broadcast; the box score loads it when opened.
create table public.mlb_lineups (
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  mlb_team_id integer not null references public.mlb_teams (id),
  players jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (game_pk, mlb_team_id)
);

alter table public.mlb_lineups enable row level security;
create policy "signed-in users can read" on public.mlb_lineups for select to authenticated using (true);
grant select on public.mlb_lineups to authenticated;
