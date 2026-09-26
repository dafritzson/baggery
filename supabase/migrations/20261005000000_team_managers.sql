-- Seasons played in the app count for the same managers as the imported ones, so the Almanac
-- sees a manager's whole career. An imported team's manager comes from the old sheets and its
-- account from the manager's link; an app-played team is the other way around: its account is
-- whoever claimed it, and its manager comes from that account's link.

-- Claiming, assigning or freeing a spot in an app-played season sets its manager.
create function private.team_manager() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.seasons where id = new.season_id and imported_at is null) then
    new.manager_id := (
      select m.id from public.league_managers m
      join public.seasons s on s.league_id = m.league_id
      where s.id = new.season_id and m.user_id = new.user_id
    );
  end if;
  return new;
end;
$$;

create trigger team_manager
  before insert or update of user_id on public.fantasy_teams
  for each row execute function private.team_manager();

-- Linking also moves the account's app-played teams to the manager (and unlinking takes them back).
create or replace function public.link_manager(p_manager_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id from public.league_managers where id = p_manager_id;
  if v_league_id is null then
    raise exception 'Manager not found';
  end if;
  if not exists (
    select 1 from public.league_members
    where league_id = v_league_id and user_id = auth.uid() and role = 'commissioner'
  ) then
    raise exception 'Only the commissioner can link managers';
  end if;
  if p_user_id is not null
     and not exists (select 1 from public.league_members where league_id = v_league_id and user_id = p_user_id) then
    raise exception 'That person isn''t in the league';
  end if;

  begin
    update public.league_managers set user_id = p_user_id where id = p_manager_id;
  exception when unique_violation then
    raise exception 'That account is already linked to another manager';
  end;

  -- Imported seasons: the manager's teams belong to the account.
  update public.fantasy_teams t set user_id = p_user_id
  from public.seasons s
  where s.id = t.season_id and s.imported_at is not null and t.manager_id = p_manager_id;

  -- Seasons played in the app: the account's teams count for the manager.
  update public.fantasy_teams t set manager_id = null
  from public.seasons s
  where s.id = t.season_id and s.imported_at is null and t.manager_id = p_manager_id;
  if p_user_id is not null then
    update public.fantasy_teams t set manager_id = p_manager_id
    from public.seasons s
    where s.id = t.season_id and s.imported_at is null and s.league_id = v_league_id and t.user_id = p_user_id;
  end if;
end;
$$;

-- Teams claimed before this by accounts that are already linked.
update public.fantasy_teams t set manager_id = m.id
from public.seasons s, public.league_managers m
where s.id = t.season_id and s.imported_at is null
  and m.league_id = s.league_id and m.user_id = t.user_id;
