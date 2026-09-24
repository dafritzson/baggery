-- Teams become claimable spots instead of teams tied to a person's name. Each season has
-- numbered spots; whoever claims one names the team (and can rename it any time). Unnamed,
-- unclaimed spots get a random "<adjective> Bagger" name in the app.
-- The commissioner becomes a role on the user's account for the league.

-- ---------------------------------------------------------------------------
-- Spots
-- ---------------------------------------------------------------------------

-- Numbered per season in the old alphabetical order, so existing teams keep a stable spot.
alter table public.fantasy_teams add column slot smallint;
update public.fantasy_teams t
set slot = n.slot
from (
  select id, row_number() over (partition by season_id order by manager_name) as slot
  from public.fantasy_teams
) n
where n.id = t.id;
alter table public.fantasy_teams
  alter column slot set not null,
  add constraint fantasy_teams_slot_positive check (slot >= 1),
  add constraint fantasy_teams_season_slot unique (season_id, slot);

-- Team names: 1 to 30 characters, unique within a season ignoring case.
alter table public.fantasy_teams
  add constraint fantasy_teams_name_length check (name is null or char_length(name) between 1 and 30);
create unique index fantasy_teams_unique_name on public.fantasy_teams (season_id, lower(name)) where name is not null;

-- ---------------------------------------------------------------------------
-- Commissioner: a league role on the user's account
-- ---------------------------------------------------------------------------

-- Whoever manages a team is a league member; whoever manages the commissioner team is the commissioner.
insert into public.league_members (league_id, user_id)
select distinct s.league_id, t.user_id
from public.fantasy_teams t
join public.seasons s on s.id = t.season_id
where t.user_id is not null
on conflict do nothing;

update public.league_members m
set role = 'commissioner'
from public.seasons s
join public.fantasy_teams t on t.id = s.commissioner_team_id
where m.league_id = s.league_id and m.user_id = t.user_id;

create or replace function public.is_commissioner(p_season_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.seasons s
    join public.league_members m on m.league_id = s.league_id
    where s.id = p_season_id and m.user_id = auth.uid() and m.role = 'commissioner'
  );
$$;

alter table public.seasons drop column commissioner_team_id;
alter table public.fantasy_teams drop column manager_name;

-- ---------------------------------------------------------------------------
-- Claiming and naming
-- ---------------------------------------------------------------------------

-- Trims and collapses spaces; rejects empty and over-long names.
create function public.clean_team_name(p_name text) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_name) = 0 then
    raise exception 'Enter a team name';
  end if;
  if char_length(v_name) > 30 then
    raise exception 'Team names can be at most 30 characters';
  end if;
  return v_name;
end;
$$;

-- A signed-in user claims an open spot and names the team. One team per user per season.
-- In a league without a commissioner (a brand-new league), the first to claim becomes it.
drop function public.claim_team(uuid);
create function public.claim_team(p_team_id uuid, p_name text) returns void
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

-- The team's manager or the commissioner renames a team.
create function public.rename_team(p_team_id uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_season_id uuid;
  v_owner uuid;
begin
  select season_id, user_id into v_season_id, v_owner from public.fantasy_teams where id = p_team_id;
  if v_season_id is null then
    raise exception 'Team not found';
  end if;
  if v_owner is distinct from auth.uid() and not public.is_commissioner(v_season_id) then
    raise exception 'You can only rename your own team';
  end if;
  begin
    update public.fantasy_teams set name = public.clean_team_name(p_name) where id = p_team_id;
  exception when unique_violation then
    raise exception 'That team name is taken';
  end;
end;
$$;

-- Commissioner fixes a wrong claim. Null frees the spot, which also clears its name.
create or replace function public.assign_team(p_team_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_commissioner((select season_id from public.fantasy_teams where id = p_team_id)) then
    raise exception 'Only the commissioner can assign teams';
  end if;
  update public.fantasy_teams
  set user_id = p_user_id, name = case when p_user_id is null then null else name end
  where id = p_team_id;
end;
$$;

revoke execute on function public.claim_team, public.rename_team, public.clean_team_name from anon, public;
grant execute on function public.claim_team, public.rename_team to authenticated;
