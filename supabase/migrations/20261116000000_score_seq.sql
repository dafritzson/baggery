-- Numbers the scores broadcasts, so an app notices one it missed and reloads. When Realtime starts
-- up (an app connects after none were), broadcasts sent before its replication slot is ready are
-- never streamed, and an app that missed one kept the stale row until it was relaunched.
--
-- Each broadcast carries `seq`, one more than the last, and scores_load returns the `seq` of the
-- last broadcast it includes. An app that hears a number more than one past the last it has
-- reloads. The counter is a row, bumped in the broadcast's own transaction, rather than a sequence
-- (which ignores transactions): a load sees number N only once broadcast N, and every change in
-- it, is committed. A failed send still uses its number, so the next broadcast shows the gap.

alter table private.poller add column score_seq bigint not null default 0;

create or replace function private.flush_score_changes() returns void
language plpgsql
as $$
declare
  reload boolean;
  games jsonb;
  stats jsonb;
  hits jsonb;
  payload jsonb;
  seq bigint;
begin
  with taken as (delete from private.score_changes returning id, tbl, key, row),
  latest as (select distinct on (tbl, key) tbl, row from taken order by tbl, key, id desc)
  select
    coalesce(bool_or(tbl = 'reload'), false),
    coalesce(jsonb_agg(row) filter (where tbl = 'mlb_games'), '[]'::jsonb),
    coalesce(jsonb_agg(row) filter (where tbl = 'player_game_stats'), '[]'::jsonb),
    coalesce(jsonb_agg(row) filter (where tbl = 'mlb_hits'), '[]'::jsonb)
  into reload, games, stats, hits
  from latest;

  if not reload and jsonb_array_length(games) = 0 and jsonb_array_length(stats) = 0 and jsonb_array_length(hits) = 0 then
    return;
  end if;
  payload := jsonb_build_object('games', games, 'stats', stats, 'hits', hits);
  -- Broadcast payloads are capped at 256 KB on the Free plan.
  if reload or octet_length(payload::text) > 200000 then
    payload := jsonb_build_object('reload', true);
  end if;
  update private.poller set score_seq = score_seq + 1 returning score_seq into seq;
  payload := payload || jsonb_build_object('seq', seq);

  begin
    perform realtime.send(payload, 'changes', 'scores', true);
  exception when others then
    raise warning 'scores broadcast failed: %', sqlerrm;
  end;
end;
$$;

-- The number of the last scores broadcast, for scores_load: its callers can't read private.
-- Stable, so it reads the same snapshot as the rest of the load.
create function public.scores_seq() returns bigint
language sql stable security definer set search_path = ''
as $$
  select score_seq from private.poller;
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
    'seq', public.scores_seq(),
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
