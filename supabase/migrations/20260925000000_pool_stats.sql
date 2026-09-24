-- Regular-season stats for the draft room's player table, filled in by sync-pool.

alter table public.season_mlb_teams
  add column wins smallint,
  add column has_bye boolean not null default false;

alter table public.season_player_pool
  add column plate_appearances smallint not null default 0,
  add column slg numeric(4, 3),
  add column ops_plus smallint;
