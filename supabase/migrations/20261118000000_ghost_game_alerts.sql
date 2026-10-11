-- Game alerts set to "My Baggers" (scope 'mine') matched only the team a device's user owns, and
-- nobody owns the ghost team, so its managers (the eliminated managers who make its picks) heard
-- nothing about the hitters they gave it. They now get the ghost's alerts as their own team's.

/** Whether a user's "My Baggers" alerts cover a team: their own, or the ghost if they make its picks. */
create function private.alerts_mine(p_user_id uuid, p_team_id uuid) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.fantasy_teams t
    where t.id = p_team_id
      and (t.user_id = p_user_id
           or (t.is_ghost and exists (
             select 1 from public.drafts d
             cross join jsonb_array_elements(d.ghost_turns) g
             join public.fantasy_teams o on o.id = (g ->> 'by')::uuid
             where d.season_id = t.season_id and o.user_id = p_user_id))));
$$;

revoke execute on function private.alerts_mine from anon, authenticated, public;

-- As before (alert_settings migration), with the ghost for its managers.
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
   and ((s.scope = 'mine' and private.alerts_mine(s.user_id, t.id))
        or (s.scope = 'league' and exists (
          select 1 from public.league_members m where m.league_id = se.league_id and m.user_id = s.user_id)))
  where r.mlb_player_id = new.mlb_player_id
    and r.from_at <= v_start and (r.to_at is null or v_start < r.to_at)
  on conflict do nothing;
  return null;
end;
$$;
