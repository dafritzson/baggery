-- Stat correction alerts, on by default: "✏️ Stat correction for Mookie Betts" / "Double changed to
-- a single: −1 bag for Bag Boys (Mike)" when the official scorer changes a drafted hitter's total
-- bases. poll-games already reads a finished game's box score every 10 minutes for 6 hours to pick
-- these up; until now they changed the standings quietly.
--
-- A trigger records each change of a batting line's total bases that isn't a bag alert's (a bag
-- taken away, or given after the game's bag window), and poll-games queues the alerts after each
-- poll (private.push_queue, like sub, cut and lineup alerts).

alter table public.push_subscriptions
  add column correction_alerts boolean not null default true;

-- A batting line's hits before and after a scoring change that moved its total bases.
create table private.stat_corrections (
  id bigint generated always as identity primary key,
  game_pk integer not null,
  mlb_player_id integer not null,
  old_h smallint not null,
  old_doubles smallint not null,
  old_triples smallint not null,
  old_hr smallint not null,
  h smallint not null,
  doubles smallint not null,
  triples smallint not null,
  hr smallint not null,
  created_at timestamptz not null default now()
);

/**
 * Records a scoring change to a batting line's total bases, for a game on now or finished within
 * the poller's 6 hours of re-checks: a reload of older games stays quiet, and so does a line's
 * first read. A bag collect_bag alerted isn't one (it runs first, triggers going by name): a bag
 * gained is a correction only when it's given back after being taken away (its bag already
 * alerted), or after the game's bag window.
 */
create function private.collect_correction() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tb = old.tb then
    return null;
  end if;
  perform 1 from public.mlb_games
  where game_pk = new.game_pk
    and (status = 'Live' or (status = 'Final' and final_seen_at > now() - interval '6 hours'));
  if not found then
    return null;
  end if;
  if new.tb > old.tb and exists (
    select 1 from private.bag_events
    where game_pk = new.game_pk and mlb_player_id = new.mlb_player_id and tb = new.tb and created_at = now()
  ) then
    return null;
  end if;

  insert into private.stat_corrections
    (game_pk, mlb_player_id, old_h, old_doubles, old_triples, old_hr, h, doubles, triples, hr)
  values
    (new.game_pk, new.mlb_player_id, old.h, old.doubles, old.triples, old.hr, new.h, new.doubles, new.triples, new.hr);
  return null;
end;
$$;

create trigger collect_correction after update of tb on public.player_game_stats
  for each row execute function private.collect_correction();
