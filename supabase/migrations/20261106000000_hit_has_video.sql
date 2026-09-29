-- The Games tab's ▶ on a hitter only shows once one of his hits in the game has a video: MLB's
-- clip or Savant's. So the scores load and broadcast carry a hit's has_video, and a clip or
-- Savant's video turning up now rides the poll's one broadcast like a new hit.

alter table public.mlb_hits
  add column has_video boolean generated always as (clip_slug is not null or savant_ready) stored;

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
      'event', new.event, 'ended_at', new.ended_at, 'has_video', new.has_video));
  else
    insert into private.score_changes (tbl, key, row)
    values ('player_game_stats', new.game_pk || ':' || new.mlb_player_id, to_jsonb(new));
  end if;
  return null;
end;
$$;

-- A generated column is never in an UPDATE's SET list, so fire on the columns it's made from.
drop trigger collect_score_change on public.mlb_hits;
create trigger collect_score_change after insert or delete or update of mlb_player_id, event, ended_at, clip_slug, savant_ready
  on public.mlb_hits for each row execute function private.collect_score_change();
