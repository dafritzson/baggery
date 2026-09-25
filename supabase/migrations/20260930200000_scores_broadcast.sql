-- Live scores reach open apps as one Broadcast message per poll, instead of one realtime
-- message per changed row per app (postgres_changes). The Free plan allows 100 realtime
-- messages a second, and a busy day of live games with a dozen apps open would pass that.
--
-- Triggers collect changed game and batting-line rows in an outbox; poll-games calls
-- private.flush_score_changes() after each poll, which sends them in one message on the public
-- "scores" topic (event "changes"). The data is public MLB stats.

alter publication supabase_realtime drop table public.mlb_games, public.player_game_stats;

create table private.score_changes (
  id bigserial primary key,
  -- 'mlb_games', 'player_game_stats', or 'reload' (a delete: apps reload everything).
  tbl text not null,
  key text not null,
  row jsonb
);

create function private.collect_score_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    insert into private.score_changes (tbl, key) values ('reload', '');
  elsif tg_table_name = 'mlb_games' then
    insert into private.score_changes (tbl, key, row) values ('mlb_games', new.game_pk::text, to_jsonb(new));
  else
    insert into private.score_changes (tbl, key, row)
    values ('player_game_stats', new.game_pk || ':' || new.mlb_player_id, to_jsonb(new));
  end if;
  return null;
end;
$$;

create trigger collect_score_change after insert or update or delete on public.mlb_games
  for each row execute function private.collect_score_change();
create trigger collect_score_change after insert or update or delete on public.player_game_stats
  for each row execute function private.collect_score_change();

/**
 * Sends everything collected since the last flush as one message: the latest version of each
 * changed row, or { reload: true } after a delete or when it's too big for one message (a full
 * season reload). A failed send is logged, not raised, so it never fails the poll.
 */
create function private.flush_score_changes() returns void
language plpgsql
as $$
declare
  reload boolean;
  games jsonb;
  stats jsonb;
  payload jsonb;
begin
  with taken as (delete from private.score_changes returning id, tbl, key, row),
  latest as (select distinct on (tbl, key) tbl, row from taken order by tbl, key, id desc)
  select
    coalesce(bool_or(tbl = 'reload'), false),
    coalesce(jsonb_agg(row) filter (where tbl = 'mlb_games'), '[]'::jsonb),
    coalesce(jsonb_agg(row) filter (where tbl = 'player_game_stats'), '[]'::jsonb)
  into reload, games, stats
  from latest;

  if not reload and jsonb_array_length(games) = 0 and jsonb_array_length(stats) = 0 then
    return;
  end if;
  payload := jsonb_build_object('games', games, 'stats', stats);
  -- Broadcast payloads are capped at 256 KB on the Free plan.
  if reload or octet_length(payload::text) > 200000 then
    payload := jsonb_build_object('reload', true);
  end if;

  begin
    perform realtime.send(payload, 'changes', 'scores', false);
  exception when others then
    raise warning 'scores broadcast failed: %', sqlerrm;
  end;
end;
$$;

-- Also poll (and so flush) when changes are waiting, e.g. after a hand edit between games.
create or replace function private.poll_due() returns boolean
language sql stable
as $$
  select private.schedule_due()
    or exists (select 1 from private.score_changes)
    or exists (
      select 1 from public.mlb_games g
      left join private.box_reads b using (game_pk)
      where g.status = 'Live'
         or (g.status = 'Final' and g.final_seen_at > now() - interval '6 hours'
             and (b.read_at is null or b.read_at < now() - interval '10 minutes'))
    );
$$;
