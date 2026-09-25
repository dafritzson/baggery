-- Poll live games as often as is sensible, everything else rarely:
--   live games: box score and inning state every 5 seconds (the cron job's pace);
--   the schedule (status, start times): every minute while a game is on or about to start, so
--     a game shows as Live / Final within a minute; every 10 minutes otherwise;
--   finished games: box score every 10 minutes for 6 hours, for official scoring changes.

-- When the poller last read each game's box score. Kept out of mlb_games so these writes don't
-- send realtime updates to every open app.
create table private.box_reads (
  game_pk integer primary key references public.mlb_games (game_pk) on delete cascade,
  read_at timestamptz not null
);

/** A game is on, or about to start (its start time is set and within 10 minutes). */
create function private.games_on() returns boolean
language sql stable
as $$
  select exists (
    select 1 from public.mlb_games
    where status = 'Live'
       or (status = 'Preview' and not start_time_tbd
           and start_time < now() + interval '10 minutes' and start_time > now() - interval '12 hours')
  );
$$;

/** The schedule is due for a read: every minute while games are on, every 10 minutes otherwise. */
create function private.schedule_due() returns boolean
language sql stable
as $$
  select schedule_synced_at is null
      or schedule_synced_at < now() - case when private.games_on() then interval '1 minute' else interval '10 minutes' end
  from private.poller;
$$;

/** Whether a poll would do anything: a live game, a due schedule read, or a finished game to re-check. */
create or replace function private.poll_due() returns boolean
language sql stable
as $$
  select private.schedule_due()
    or exists (
      select 1 from public.mlb_games g
      left join private.box_reads b using (game_pk)
      where g.status = 'Live'
         or (g.status = 'Final' and g.final_seen_at > now() - interval '6 hours'
             and (b.read_at is null or b.read_at < now() - interval '10 minutes'))
    );
$$;

-- Same job name, so this replaces the 10-second schedule.
select cron.schedule('poll-games', '5 seconds', 'select private.poll_games()');
