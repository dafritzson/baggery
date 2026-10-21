-- xBags from this postseason's playing time: beside each hitter's postseason PA and TB, his
-- starts (all of them and by the opposing starter's hand, from mlb_probables) and his plate
-- appearances in them. A start is a batting order on the hundred ("300" bats third; "301" came
-- in for him). The player popup asks for one hitter only.

drop function public.postseason_totals(integer, timestamptz);

/**
 * Each hitter's postseason PA, TB, starts (all, against left- and against right-handed starters)
 * and PA in his starts in a season, from the games that started before `before` (all of them when
 * null; a finished draft's board passes its lock time), for one hitter when `player` is given.
 * One small row per hitter, so the draft table doesn't download every box score. PA is null when
 * any of his rows predates the pa column, and the starts and start PA when any has no batting
 * order. A start against a starter nobody recorded counts in his starts but neither hand's.
 */
create function public.postseason_totals(p_year integer, p_before timestamptz default null, p_player integer default null)
returns table (mlb_player_id integer, pa integer, tb integer, starts integer, starts_vs_l integer, starts_vs_r integer, start_pa integer)
language sql stable set search_path = ''
as $$
  with rows as (
    select s.mlb_player_id, s.pa, s.tb, s.batting_order,
           s.batting_order % 100 = 0 as started,
           p.hand
    from public.player_game_stats s
    join public.mlb_games g using (game_pk)
    left join public.mlb_probables p
      on p.game_pk = s.game_pk
     and p.mlb_team_id = case when s.mlb_team_id = g.home_team_id then g.away_team_id else g.home_team_id end
    where g.season_year = p_year
      and (p_before is null or g.start_time < p_before)
      and (p_player is null or s.mlb_player_id = p_player)
  )
  select mlb_player_id,
         case when count(pa) = count(*) then sum(pa)::integer end,
         sum(tb)::integer,
         case when count(batting_order) = count(*) then (count(*) filter (where started))::integer end,
         case when count(batting_order) = count(*) then (count(*) filter (where started and hand = 'L'))::integer end,
         case when count(batting_order) = count(*) then (count(*) filter (where started and hand = 'R'))::integer end,
         case when count(pa) = count(*) and count(batting_order) = count(*)
              then coalesce(sum(pa) filter (where started), 0)::integer end
  from rows
  group by mlb_player_id;
$$;

revoke execute on function public.postseason_totals from anon, public;
grant execute on function public.postseason_totals to authenticated;
