-- The poll-games cron job runs on its own schedule per project, and only quickly while games are
-- on. Each run writes log lines (the function call, its runtime and its connections), and Supabase
-- now meters log ingestion (1 GB a month on Free, shared by staging and production): running every
-- 10 seconds all day, both projects together were on course for about 2 GB.
--
-- live_schedule while a game is live or about to start, or alerts are waiting; idle_schedule
-- otherwise, which is still more often than anything idle needs (the schedule every 10 minutes,
-- finished games every 10). Production keeps the defaults; staging only follows games once a
-- minute, set by hand there:
--   update private.poller set live_schedule = '* * * * *';
alter table private.poller
  add column live_schedule text not null default '15 seconds',
  add column idle_schedule text not null default '* * * * *';

create or replace function private.poll_games() returns void
language plpgsql
as $$
declare
  cfg private.poller;
  job_id bigint;
  current_schedule text;
  wanted text;
begin
  select * into cfg from private.poller;

  wanted := case
    when private.games_on()
      or exists (select 1 from private.score_changes)
      or exists (select 1 from private.bag_alerts)
      or exists (select 1 from private.push_queue)
    then cfg.live_schedule
    else cfg.idle_schedule
  end;
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
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

-- pg_cron records every run in cron.job_run_details (~8,600 rows a day per project at 10 seconds,
-- 14 MB on production by early October). Keep two days.
select cron.schedule(
  'purge-cron-history',
  '17 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '2 days'$$
);
