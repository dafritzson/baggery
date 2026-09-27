-- Two more kinds of alert, next to bag alerts, for the devices that have alerts on:
--
-- - Subs: "👀 Kiké Hernández is in the game" when a drafted hitter comes off the bench, and
--   "😠 Mookie Betts is out of the game" when one is replaced (pinch-hit for, pinch-run for, a
--   defensive switch, an injury). poll-games reads them from the box score it already fetches.
-- - The cut line: "🥵 You're on the hot seat" when a team drops below the round's cut, and
--   "😮‍💨 Off the chopping block" when it climbs back above. Checked once each game of the round has
--   its final box score, so the flips of a game in progress don't each send one.
--
-- Both are on by default for a device with alerts on; Settings turns each off.

alter table public.push_subscriptions
  add column sub_alerts boolean not null default true,
  add column cut_alerts boolean not null default true;

-- A lineup change of a drafted hitter already alerted: 'in' (came off the bench) or 'out' (was
-- replaced). Unique, so the box score read every 10 seconds alerts each one once.
create table private.lineup_events (
  game_pk integer not null,
  mlb_player_id integer not null,
  kind text not null check (kind in ('in', 'out')),
  created_at timestamptz not null default now(),
  primary key (game_pk, mlb_player_id, kind)
);

-- Each alive team's side of the cut line in the round being played, at the last check: `danger`
-- when it's below the cut or tied across it. A round's first check only records it.
create table private.cut_standings (
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  round smallint not null,
  danger boolean not null,
  updated_at timestamptz not null default now(),
  primary key (fantasy_team_id, round)
);

-- Finished games the cut line has been checked after.
create table private.cut_checks (
  game_pk integer primary key,
  checked_at timestamptz not null default now()
);

-- Alerts waiting out a spoiler delay, their text already written (sub and cut alerts; bag alerts
-- keep their own queue, private.bag_alerts).
create table private.push_queue (
  id bigint generated always as identity primary key,
  endpoint text not null references public.push_subscriptions (endpoint) on delete cascade,
  send_at timestamptz not null,
  title text not null,
  body text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index push_queue_due on private.push_queue (send_at);

-- Keep the cron job calling poll-games while these alerts wait out a spoiler delay too.
create or replace function private.poll_due() returns boolean
language sql stable
as $$
  select private.schedule_due()
    or exists (select 1 from private.score_changes)
    or exists (select 1 from private.bag_alerts)
    or exists (select 1 from private.push_queue)
    or exists (
      select 1 from public.mlb_games g
      left join private.box_reads b using (game_pk)
      where g.status = 'Live'
         or (g.status = 'Final' and g.final_seen_at > now() - interval '6 hours'
             and (b.read_at is null or b.read_at < now() - interval '10 minutes'))
    );
$$;
