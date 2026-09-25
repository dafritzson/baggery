-- More regular-season counts for the draft room table's optional columns (H, 2B, 3B, HR, R, RBI,
-- BB, SO, and AVG/OBP/OPS from them), filled in by sync-pool. Null until the pool is next synced.

alter table public.season_player_pool
  add column hits smallint,
  add column doubles smallint,
  add column triples smallint,
  add column home_runs smallint,
  add column runs smallint,
  add column rbi smallint,
  add column walks smallint,
  add column strikeouts smallint,
  add column hit_by_pitch smallint,
  add column sac_flies smallint;
