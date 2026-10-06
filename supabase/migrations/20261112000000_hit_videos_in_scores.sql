-- A hit's clip (slug) and whether Savant's video is up now come with the hits in the scores load
-- and in the scores broadcast, so the Standings scrubber shows a bag's video links from the scores
-- the app already has instead of loading them each time playback stops on a bag (~370 requests
-- and their CORS preflights a game day on production, each writing Supabase logs, which are
-- metered). The broadcast already fires when either changes (collect_score_change's trigger is on
-- clip_slug and savant_ready), so links now also appear as soon as a video is posted.
-- ~60 bytes more per hit: a few hundred hits by the World Series, ~20 KB more per scores load.

create or replace function private.collect_score_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into private.score_changes (tbl, key) values ('reload', '');
  elsif tg_table_name = 'mlb_games' then
    insert into private.score_changes (tbl, key, row) values ('mlb_games', new.game_pk::text, to_jsonb(new));
  elsif tg_table_name = 'mlb_hits' then
    insert into private.score_changes (tbl, key, row)
    values ('mlb_hits', new.play_id::text, jsonb_build_object(
      'play_id', new.play_id, 'game_pk', new.game_pk, 'mlb_player_id', new.mlb_player_id,
      'event', new.event, 'ended_at', new.ended_at, 'has_video', new.has_video,
      'clip_slug', new.clip_slug, 'savant_ready', new.savant_ready));
  else
    insert into private.score_changes (tbl, key, row)
    values ('player_game_stats', new.game_pk || ':' || new.mlb_player_id, to_jsonb(new));
  end if;
  return null;
end;
$$;

create or replace function public.scores_load(p_year int, p_players int[]) returns json
language sql stable security invoker set search_path = ''
as $$
  with games as (
    select game_pk, game_type, series_game_number, start_time, start_time_tbd, official_date, status,
      detailed_state, home_team_id, away_team_id, home_score, away_score, live, games_in_series,
      final_seen_at
    from public.mlb_games where season_year = p_year
  )
  select json_build_object(
    'games', coalesce((select json_agg(g) from games g), '[]'),
    'stats', coalesce((
      select json_agg(json_build_object(
        'game_pk', s.game_pk, 'mlb_player_id', s.mlb_player_id, 'tb', s.tb, 'ab', s.ab, 'h', s.h,
        'bb', s.bb, 'hbp', s.hbp, 'sf', s.sf, 'hr', s.hr, 'r', s.r, 'rbi', s.rbi
      ))
      from public.player_game_stats s
      where s.game_pk in (select game_pk from games) and s.mlb_player_id = any(p_players)
    ), '[]'),
    'hits', coalesce((
      select json_agg(json_build_object(
        'play_id', h.play_id, 'game_pk', h.game_pk, 'mlb_player_id', h.mlb_player_id,
        'event', h.event, 'ended_at', h.ended_at, 'has_video', h.has_video,
        'clip_slug', h.clip_slug, 'savant_ready', h.savant_ready
      ))
      from public.mlb_hits h
      where h.game_pk in (select game_pk from games) and h.mlb_player_id = any(p_players)
    ), '[]'),
    'lines', coalesce((
      select json_agg(json_build_object(
        'game_pk', s.game_pk, 'mlb_player_id', s.mlb_player_id, 'ab', s.ab, 'h', s.h,
        'doubles', s.doubles, 'triples', s.triples, 'hr', s.hr, 'bb', s.bb,
        'batting_order', s.batting_order
      ))
      from public.player_game_stats s
      where s.game_pk in (select game_pk from games where status = 'Live')
    ), '[]')
  );
$$;
