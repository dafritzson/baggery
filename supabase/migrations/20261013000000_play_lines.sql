-- Every play's addition to each player's batting line: the batter's plate appearance, and a run
-- for each runner who scored on it. With these the Standings can rebuild any moment of a game
-- exactly (tiebreakers included), where a box score only has how the game ended. poll-games
-- saves them from each game's play-by-play, with the hits; past seasons come from a migration.
-- The app loads a day's rows only when the Standings are scrubbed into the middle of that day.

create table public.mlb_play_lines (
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  -- The play's index in the game (MLB's atBatIndex).
  at_bat smallint not null,
  mlb_player_id integer not null,
  ended_at timestamptz,
  pa smallint not null default 0,
  ab smallint not null default 0,
  h smallint not null default 0,
  tb smallint not null default 0,
  hr smallint not null default 0,
  bb smallint not null default 0,
  hbp smallint not null default 0,
  sf smallint not null default 0,
  r smallint not null default 0,
  rbi smallint not null default 0,
  primary key (game_pk, at_bat, mlb_player_id)
);

alter table public.mlb_play_lines enable row level security;
create policy "signed-in users can read" on public.mlb_play_lines for select to authenticated using (true);
grant select on public.mlb_play_lines to authenticated;
