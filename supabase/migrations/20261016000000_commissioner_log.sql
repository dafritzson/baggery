-- The commissioner log: every commissioner action, who took it and when, for accountability.
-- Rows are written in the same transaction as the action (by the Edge Functions and the
-- commissioner RPCs below), so neither exists without the other. Only the league's commissioner
-- can read it, and nobody can change or delete it through the API.

create table public.commissioner_log (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  -- Kept when its season is deleted (importing a past year again replaces that season).
  season_id uuid references public.seasons (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  -- What happened, in words, with names as they were at the time.
  summary text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index commissioner_log_league on public.commissioner_log (league_id, created_at desc);

alter table public.commissioner_log enable row level security;

create policy "the commissioner can read" on public.commissioner_log
  for select to authenticated
  using (exists (
    select 1 from public.league_members
    where league_id = commissioner_log.league_id and user_id = auth.uid() and role = 'commissioner'
  ));

-- Signed-in users get select on new tables by default (row level security narrows it); spelled
-- out here that the log can't be written through the API.
revoke insert, update, delete, truncate on public.commissioner_log from anon, authenticated;

-- A team as the log names it: its name, else whose it is.
create function private.team_label(p_team_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    t.name,
    (select p.display_name || '''s team' from public.profiles p where p.id = t.user_id),
    (select m.name || '''s team' from public.league_managers m where m.id = t.manager_id),
    'an open spot'
  )
  from public.fantasy_teams t where t.id = p_team_id;
$$;

create function private.log_commissioner(p_season_id uuid, p_action text, p_summary text, p_details jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.commissioner_log (league_id, season_id, user_id, action, summary, details)
  select league_id, id, auth.uid(), p_action, p_summary, p_details from public.seasons where id = p_season_id;
$$;

revoke execute on function private.team_label, private.log_commissioner from anon, authenticated, public;

-- Renaming someone else's team is a commissioner action; renaming your own isn't.
create or replace function public.rename_team(p_team_id uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_season_id uuid;
  v_owner uuid;
  v_before text;
  v_after text;
begin
  select season_id, user_id into v_season_id, v_owner from public.fantasy_teams where id = p_team_id;
  if v_season_id is null then
    raise exception 'Team not found';
  end if;
  if v_owner is distinct from auth.uid() and not public.is_commissioner(v_season_id) then
    raise exception 'You can only rename your own team';
  end if;
  v_before := private.team_label(p_team_id);
  begin
    update public.fantasy_teams set name = public.clean_team_name(p_name) where id = p_team_id
    returning name into v_after;
  exception when unique_violation then
    raise exception 'That team name is taken';
  end;
  if v_owner is distinct from auth.uid() and v_before is distinct from v_after then
    perform private.log_commissioner(
      v_season_id, 'rename_team', format('Renamed %s to %s', v_before, v_after),
      jsonb_build_object('teamId', p_team_id, 'before', v_before, 'after', v_after)
    );
  end if;
end;
$$;

-- Commissioner fixes a wrong claim. Null frees the spot, which also clears its name.
create or replace function public.assign_team(p_team_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_season_id uuid;
  v_before uuid;
  v_label text;
begin
  select season_id, user_id into v_season_id, v_before from public.fantasy_teams where id = p_team_id;
  if not public.is_commissioner(v_season_id) then
    raise exception 'Only the commissioner can assign teams';
  end if;
  v_label := private.team_label(p_team_id);
  update public.fantasy_teams
  set user_id = p_user_id, name = case when p_user_id is null then null else name end
  where id = p_team_id;
  if v_before is distinct from p_user_id then
    perform private.log_commissioner(
      v_season_id, 'assign_team',
      case
        when p_user_id is null then format('Freed %s', v_label)
        else format('Gave %s to %s', v_label, (select display_name from public.profiles where id = p_user_id))
      end
      || coalesce(format(' (was %s''s)', (select display_name from public.profiles where id = v_before)), ''),
      jsonb_build_object('teamId', p_team_id, 'before', v_before, 'after', p_user_id)
    );
  end if;
end;
$$;

-- Unchanged but for the log line at the end.
create or replace function public.link_manager(p_manager_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_league_id uuid;
  v_name text;
  v_before uuid;
begin
  select league_id, name, user_id into v_league_id, v_name, v_before from public.league_managers where id = p_manager_id;
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

  if v_before is distinct from p_user_id then
    insert into public.commissioner_log (league_id, user_id, action, summary, details)
    values (
      v_league_id, auth.uid(), 'link_manager',
      case
        when p_user_id is null then format('Unlinked past manager %s', v_name)
        else format('Linked past manager %s to %s', v_name, (select display_name from public.profiles where id = p_user_id))
      end,
      jsonb_build_object('managerId', p_manager_id, 'before', v_before, 'after', p_user_id)
    );
  end if;
end;
$$;
