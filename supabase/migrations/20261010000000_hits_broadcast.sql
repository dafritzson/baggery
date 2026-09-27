-- The Games tab draws a player's bags hit by hit (one emoji per hit, in the order they happened),
-- so apps get each hit (mlb_hits) with the scores: in the scores load, and in the scores broadcast
-- as poll-games finds them. Only a hit being added or changing counts; a clip turning up doesn't.

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
      'event', new.event, 'ended_at', new.ended_at));
  else
    insert into private.score_changes (tbl, key, row)
    values ('player_game_stats', new.game_pk || ':' || new.mlb_player_id, to_jsonb(new));
  end if;
  return null;
end;
$$;

create trigger collect_score_change after insert or delete or update of mlb_player_id, event, ended_at
  on public.mlb_hits for each row execute function private.collect_score_change();

create or replace function private.flush_score_changes() returns void
language plpgsql
as $$
declare
  reload boolean;
  games jsonb;
  stats jsonb;
  hits jsonb;
  payload jsonb;
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

  begin
    perform realtime.send(payload, 'changes', 'scores', true);
  exception when others then
    raise warning 'scores broadcast failed: %', sqlerrm;
  end;
end;
$$;
