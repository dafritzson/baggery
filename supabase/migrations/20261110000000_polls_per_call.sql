-- While games are on, the cron job calls poll-games once a minute and the call polls every
-- live_every seconds itself (4 polls at 15 s), instead of one call per poll: each call writes a few
-- KB of Supabase logs whatever it does, and log ingestion is metered (1 GB a month on Free, shared
-- by staging and production). Same 15 s between polls for the app.
--
-- With more than two games live at once, four polls could come close to the 2 s CPU limit of a
-- call, so the job then runs every live_every seconds with one poll a call, as before.
--
-- live_every replaces live_schedule: 15 on production, 60 on staging (once a minute: one poll a
-- call), carried over from what each project had.
alter table private.poller add column live_every int not null default 15 check (live_every between 5 and 60);
update private.poller set live_every = case when live_schedule like '%second%'
  then substring(live_schedule from '^\d+')::int else 60 end;
alter table private.poller drop column live_schedule;

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
    if cfg.live_every < 60 and (select count(*) from public.mlb_games where status = 'Live') > 2 then
      wanted := cfg.live_every || ' seconds';
    else
      wanted := '* * * * *';
      polls := 60 / cfg.live_every;
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
    -- A call with 4 polls takes ~50 s.
    timeout_milliseconds := 120000
  );
end;
$$;
