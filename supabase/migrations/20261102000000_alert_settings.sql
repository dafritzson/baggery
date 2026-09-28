-- Settings → Alerts, split into Draft alerts and Game alerts: a device can have draft alerts
-- without game alerts (scope 'off'), and bag alerts get their own switch like sub, cut and lineup
-- alerts. Every game alert query already matches only 'mine' or 'league', so 'off' gets none.

alter table public.push_subscriptions drop constraint push_subscriptions_scope_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_scope_check check (scope in ('off', 'mine', 'league'));

alter table public.push_subscriptions
  add column bag_alerts boolean not null default true;

-- As before (bag_alerts migration), but only for subscriptions with bag alerts on.
create or replace function private.collect_bag() returns trigger
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
    on s.bag_alerts
   and ((s.scope = 'mine' and s.user_id = t.user_id)
        or (s.scope = 'league' and exists (
          select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id)))
  where r.mlb_player_id = new.mlb_player_id
    and r.from_at <= v_start and (r.to_at is null or v_start < r.to_at)
  on conflict do nothing;
  return null;
end;
$$;
