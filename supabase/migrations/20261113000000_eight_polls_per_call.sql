-- While up to two games are live, the cron job calls poll-games every 2 minutes for 8 polls 15 s
-- apart, instead of every minute for 4: half the calls, and their Supabase logs (metered), for the
-- same 15 s between polls. A 4-poll call used 234 ms of CPU at the median and 422 ms at most with
-- two live games (production, October 5), so 8 stay well inside the 2 s limit of a call; a call
-- lasts ~110 s, inside the 150 s wall clock limit. Staging (live_every 60) still polls once a
-- minute, and more than two live games still get one poll a call every 15 s.
create or replace function private.poll_games() returns void
language plpgsql
as $$
declare
  cfg private.poller;
  job_id bigint;
  current_schedule text;
  wanted text;
  polls int := 1;
begin
  select * into cfg from private.poller;

  wanted := cfg.idle_schedule;
  if private.games_on()
     or exists (select 1 from private.score_changes)
     or exists (select 1 from private.bag_alerts)
     or exists (select 1 from private.push_queue) then
    if cfg.live_every >= 60 then
      wanted := '* * * * *';
    elsif (select count(*) from public.mlb_games where status = 'Live') > 2 then
      wanted := cfg.live_every || ' seconds';
    else
      wanted := '*/2 * * * *';
      polls := 120 / cfg.live_every;
    end if;
  end if;
  select jobid, schedule into job_id, current_schedule from cron.job where jobname = 'poll-games';
  if job_id is not null and current_schedule is distinct from wanted then
    perform cron.alter_job(job_id, schedule := wanted);
  end if;

  if cfg.function_url is null or not private.poll_due() then
    return;
  end if;
  perform net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-poller-secret', cfg.secret),
    body := jsonb_build_object('polls', polls, 'every', cfg.live_every),
    -- A call with 8 polls takes ~110 s.
    timeout_milliseconds := 150000
  );
end;
$$;
