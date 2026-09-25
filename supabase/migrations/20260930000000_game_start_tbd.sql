-- MLB lists a game whose start time isn't set yet (common for postseason games before the
-- matchup is known) at a placeholder 3:33 AM ET with status.startTimeTBD. Keep that flag so the
-- app can say "Time TBD", and the game's official date, which the Games tab groups days by.
alter table public.mlb_games
  add column start_time_tbd boolean not null default false,
  add column official_date date;

-- Same as before, except a game with no start time yet isn't "on soon" at its placeholder time.
create or replace function private.poll_due() returns boolean
language sql stable
as $$
  select
    (select schedule_synced_at is null or schedule_synced_at < now() - interval '15 minutes' from private.poller)
    or exists (
      select 1 from public.mlb_games
      where (status <> 'Final' and not start_time_tbd
             and start_time < now() + interval '10 minutes' and start_time > now() - interval '12 hours')
         or (status = 'Final' and (final_seen_at is null or final_seen_at > now() - interval '3 hours'))
    );
$$;
