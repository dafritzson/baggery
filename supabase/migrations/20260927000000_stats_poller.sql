-- Live stats: the poll-games Edge Function mirrors postseason games and box scores from the MLB
-- Stats API into mlb_games and player_game_stats. pg_cron calls it every 10 seconds, but only
-- while there is something to fetch (see private.poll_due), so it's quiet outside game time.

-- Scoreboards show a column per game of a series (WC1, DS3, ...), so keep each game's number.
alter table public.mlb_games
  add column series_game_number smallint,
  add column games_in_series smallint,
  -- When the poller first saw the game Final. Box scores are re-read for a few hours after, to
  -- pick up official scoring changes, then left alone.
  add column final_seen_at timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Server-only settings, out of reach of the API roles.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.poller (
  id boolean primary key default true check (id),
  -- The function's URL. The function writes it itself (from its SUPABASE_URL) when the deploy
  -- calls it with { setup: true }; until then the cron job does nothing.
  function_url text,
  -- Sent with each cron call so only the cron job can start a poll.
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Last full schedule read, and a lease so overlapping calls don't both poll.
  schedule_synced_at timestamptz,
  running_until timestamptz
);
insert into private.poller default values;

/** Whether a poll would do anything: a game on now or soon, one just finished, or a stale schedule. */
create function private.poll_due() returns boolean
language sql stable
as $$
  select
    (select schedule_synced_at is null or schedule_synced_at < now() - interval '15 minutes' from private.poller)
    or exists (
      select 1 from public.mlb_games
      where (status <> 'Final' and start_time < now() + interval '10 minutes' and start_time > now() - interval '12 hours')
         or (status = 'Final' and (final_seen_at is null or final_seen_at > now() - interval '3 hours'))
    );
$$;

create function private.poll_games() returns void
language plpgsql
as $$
declare
  cfg private.poller;
begin
  select * into cfg from private.poller;
  if cfg.function_url is null or not private.poll_due() then
    return;
  end if;
  perform net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-poller-secret', cfg.secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

select cron.schedule('poll-games', '10 seconds', 'select private.poll_games()');
