-- At-bats and games for the draft room's RDSLG, RDTB and TB·E[G]/162 columns, filled in by
-- sync-pool. Null until the pool is next synced.

alter table public.season_player_pool
  add column at_bats smallint,
  add column games_played smallint;
