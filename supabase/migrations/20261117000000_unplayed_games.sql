-- Games MLB schedules "if necessary" and then doesn't need (a Wild Card game 3 after a 2-0 sweep,
-- say) drop out of its schedule but stay in mlb_games as Preview, since the poller only upserts
-- the games the schedule lists. games_on() counted them as about to start for 12 hours after their
-- start time, which kept the cron job at the game-time cadence (with nothing live, a call about
-- every 4 minutes, ~15 an hour against ~6 idle) all night with no game on: on October 9, two
-- Division Series game 5s that were never played did that from 5 PM to 5 AM Pacific on both
-- projects. A game whose series one team has already won isn't coming, so it no longer counts.

/** A game is on, or about to start (its start time is set and within 10 minutes, and its series isn't over). */
create or replace function private.games_on() returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.mlb_games g
    where g.status = 'Live'
       or (g.status = 'Preview' and not g.start_time_tbd
           and g.start_time < now() + interval '10 minutes' and g.start_time > now() - interval '12 hours'
           and not exists (
             select 1 from public.mlb_games w
             where w.season_year = g.season_year and w.game_type = g.game_type and w.status = 'Final'
               and least(w.home_team_id, w.away_team_id) = least(g.home_team_id, g.away_team_id)
               and greatest(w.home_team_id, w.away_team_id) = greatest(g.home_team_id, g.away_team_id)
             group by case when w.home_score > w.away_score then w.home_team_id else w.away_team_id end
             having count(*) * 2 > coalesce(g.games_in_series, 7)))
  );
$$;
