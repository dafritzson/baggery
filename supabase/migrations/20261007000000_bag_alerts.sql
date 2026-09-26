-- Bag alerts: a push notification ("👜 Shohei Ohtani got a bag") when a drafted hitter gets a bag.
--
-- Each browser that turns alerts on in Settings saves a web push subscription here, through the
-- notifications Edge Function. When poll-games saves a batting line whose total bases went up, a
-- trigger records the bag and queues an alert for every subscription that wants it, due after
-- that subscription's spoiler delay. poll-games sends the due alerts after each poll.

create table public.push_subscriptions (
  -- The push service URL the browser gave us (Google's for Chrome, Apple's for iPhone, ...).
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The browser's keys the alerts are encrypted with.
  p256dh text not null,
  auth text not null,
  -- Whose bags: 'mine' (your team's hitters) or 'league' (every team still alive in your league).
  scope text not null default 'mine' check (scope in ('mine', 'league')),
  -- Holds alerts back for people watching a stream that runs behind the live feed.
  delay_seconds smallint not null default 0 check (delay_seconds between 0 and 600),
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- Settings reads this device's row to show its choices. Writes go through the Edge Function.
create policy "users can read their own subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- The VAPID key pair (JWK) alerts are signed with. The notifications function makes it the first
-- time it's needed, so no environment needs a secret set up by hand.
create table private.push_keys (
  id boolean primary key default true check (id),
  public_key jsonb not null,
  private_key jsonb not null
);

-- A bag: a batting line's total bases went up during a game.
create table private.bag_events (
  id bigint generated always as identity primary key,
  game_pk integer not null,
  mlb_player_id integer not null,
  -- The line's total bases after the bag. Unique, so a stat correction that takes a bag away and
  -- gives it back doesn't alert twice.
  tb smallint not null,
  bags smallint not null,
  -- The hits that made it, for the alert's text (a single, a home run, ...). A scoring change can
  -- make one negative (a single scored a double instead).
  singles smallint not null,
  doubles smallint not null,
  triples smallint not null,
  hr smallint not null,
  created_at timestamptz not null default now(),
  unique (game_pk, mlb_player_id, tb)
);

-- Alerts waiting to be sent: one per bag per subscription that wants it.
create table private.bag_alerts (
  event_id bigint not null references private.bag_events (id) on delete cascade,
  endpoint text not null references public.push_subscriptions (endpoint) on delete cascade,
  -- The team the bag counts for.
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  send_at timestamptz not null,
  primary key (event_id, endpoint)
);

create index bag_alerts_due on private.bag_alerts (send_at);

/**
 * Records a bag and queues its alerts. Only for a game on now or just finished: re-reads hours
 * later (official scoring changes) and season reloads stay quiet. "Just finished" covers the last
 * play: when the schedule marks a game Final first, its box score is read again ~10 minutes later.
 */
create function private.collect_bag() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.player_game_stats;
  v_start timestamptz;
  v_event bigint;
begin
  if tg_op = 'UPDATE' then
    v_old := old;
  else
    v_old.tb := 0; v_old.h := 0; v_old.doubles := 0; v_old.triples := 0; v_old.hr := 0;
  end if;
  if new.tb <= v_old.tb then
    return null;
  end if;

  select start_time into v_start from public.mlb_games
  where game_pk = new.game_pk
    and (status = 'Live' or (status = 'Final' and final_seen_at > now() - interval '20 minutes'));
  if not found then
    return null;
  end if;

  insert into private.bag_events (game_pk, mlb_player_id, tb, bags, singles, doubles, triples, hr)
  values (
    new.game_pk, new.mlb_player_id, new.tb, new.tb - v_old.tb,
    (new.h - new.doubles - new.triples - new.hr) - (v_old.h - v_old.doubles - v_old.triples - v_old.hr),
    new.doubles - v_old.doubles, new.triples - v_old.triples, new.hr - v_old.hr
  )
  on conflict (game_pk, mlb_player_id, tb) do nothing
  returning id into v_event;
  if v_event is null then
    return null;
  end if;

  -- The team (still alive, in a season played in the app) whose roster had the hitter when the
  -- game started, and every subscription that wants its bags.
  insert into private.bag_alerts (event_id, endpoint, fantasy_team_id, send_at)
  select v_event, s.endpoint, t.id, now() + make_interval(secs => s.delay_seconds)
  from public.roster_spells r
  join public.seasons se on se.id = r.season_id and se.imported_at is null
  join public.fantasy_teams t on t.id = r.fantasy_team_id and t.eliminated_after_round is null
  join public.push_subscriptions s
    on (s.scope = 'mine' and s.user_id = t.user_id)
    or (s.scope = 'league' and exists (
      select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id))
  where r.mlb_player_id = new.mlb_player_id
    and r.from_at <= v_start and (r.to_at is null or v_start < r.to_at)
  on conflict do nothing;
  return null;
end;
$$;

create trigger collect_bag after insert or update of tb on public.player_game_stats
  for each row execute function private.collect_bag();

-- Keep the cron job calling poll-games while alerts wait out a spoiler delay.
create or replace function private.poll_due() returns boolean
language sql stable
as $$
  select private.schedule_due()
    or exists (select 1 from private.score_changes)
    or exists (select 1 from private.bag_alerts)
    or exists (
      select 1 from public.mlb_games g
      left join private.box_reads b using (game_pk)
      where g.status = 'Live'
         or (g.status = 'Final' and g.final_seen_at > now() - interval '6 hours'
             and (b.read_at is null or b.read_at < now() - interval '10 minutes'))
    );
$$;
