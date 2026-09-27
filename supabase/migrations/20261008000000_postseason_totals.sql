-- Post PA and Post TB in the draft table: each hitter's plate appearances and total bases so far
-- this postseason, so redrafts can see who's playing and who's hitting.

-- Plate appearances from the box score. Null for rows read before this column existed (reloading a
-- postseason fills them in).
alter table public.player_game_stats add column pa smallint;

/**
 * Each hitter's postseason PA and TB in a season, from the games that started before `before` (all
 * of them when null; a finished draft's board passes its lock time). One small row per hitter, so
 * the draft table doesn't download every box score. PA is null when any of the player's rows
 * predates the pa column.
 */
create function public.postseason_totals(p_year integer, p_before timestamptz default null)
returns table (mlb_player_id integer, pa integer, tb integer)
language sql stable set search_path = ''
as $$
  select s.mlb_player_id,
         case when count(s.pa) = count(*) then sum(s.pa)::integer end,
         sum(s.tb)::integer
  from public.player_game_stats s
  join public.mlb_games g using (game_pk)
  where g.season_year = p_year and (p_before is null or g.start_time < p_before)
  group by s.mlb_player_id;
$$;

revoke execute on function public.postseason_totals from anon, public;
grant execute on function public.postseason_totals to authenticated;
