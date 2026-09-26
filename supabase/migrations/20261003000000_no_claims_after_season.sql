-- A finished season's spots can't be claimed. Imported past seasons have no owners on their
-- teams, so without this anyone could claim, say, the 2022 champion's team.

create or replace function public.claim_team(p_team_id uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_season_id uuid;
  v_league_id uuid;
  v_claimed int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select t.season_id, s.league_id into v_season_id, v_league_id
  from public.fantasy_teams t join public.seasons s on s.id = t.season_id
  where t.id = p_team_id;
  if v_season_id is null then
    raise exception 'Team not found';
  end if;
  -- Past seasons' teams (imported ones included) belong to whoever managed them; the
  -- commissioner links accounts to them instead.
  if exists (select 1 from public.seasons where id = v_season_id and status = 'complete') then
    raise exception 'That season is over, so its teams can''t be claimed';
  end if;
  if exists (select 1 from public.fantasy_teams where season_id = v_season_id and user_id = auth.uid()) then
    raise exception 'You already manage a team this season';
  end if;

  begin
    update public.fantasy_teams
    set user_id = auth.uid(), name = public.clean_team_name(p_name)
    where id = p_team_id and user_id is null;
    get diagnostics v_claimed = row_count;
  exception when unique_violation then
    raise exception 'That team name is taken';
  end;
  if v_claimed = 0 then
    raise exception 'That team is already claimed';
  end if;

  insert into public.league_members (league_id, user_id, role)
  values (
    v_league_id,
    auth.uid(),
    case
      when exists (select 1 from public.league_members where league_id = v_league_id and role = 'commissioner')
        then 'member'
      else 'commissioner'
    end::public.league_role
  )
  on conflict do nothing;
end;
$$;
