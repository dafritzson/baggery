-- Commissioner, team claiming, and the 2026 T-Baggery season.

-- The commissioner is whoever manages this team, so it can be seeded before anyone signs up.
alter table public.seasons
  add column commissioner_team_id uuid references public.fantasy_teams (id) on delete set null;

-- Google sign-in puts the person's name in full_name/name.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create function public.is_commissioner(p_season_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.seasons s
    join public.fantasy_teams t on t.id = s.commissioner_team_id
    where s.id = p_season_id and t.user_id = auth.uid()
  );
$$;

-- A signed-in user claims an unclaimed team (picks "I'm Kyle"). One team per user per season.
create function public.claim_team(p_team_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_season_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  select season_id into v_season_id from public.fantasy_teams where id = p_team_id;
  if exists (select 1 from public.fantasy_teams where season_id = v_season_id and user_id = auth.uid()) then
    raise exception 'You already manage a team this season';
  end if;
  update public.fantasy_teams set user_id = auth.uid() where id = p_team_id and user_id is null;
  if not found then
    raise exception 'That team is already claimed';
  end if;
end;
$$;

-- Commissioner fixes a wrong claim. Null unassigns the team.
create function public.assign_team(p_team_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_commissioner((select season_id from public.fantasy_teams where id = p_team_id)) then
    raise exception 'Only the commissioner can assign teams';
  end if;
  update public.fantasy_teams set user_id = p_user_id where id = p_team_id;
end;
$$;

revoke execute on function public.claim_team, public.assign_team from anon, public;
grant execute on function public.claim_team, public.assign_team, public.is_commissioner to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: T-Baggery 2026
-- ---------------------------------------------------------------------------

insert into public.leagues (id, name)
values ('7ba99e70-0000-4000-8000-000000000001', 'T-Baggery')
on conflict do nothing;

insert into public.seasons (id, league_id, year, status)
values ('7ba99e70-0000-4000-8000-000000002026', '7ba99e70-0000-4000-8000-000000000001', 2026, 'setup')
on conflict do nothing;

insert into public.fantasy_teams (season_id, manager_name)
select '7ba99e70-0000-4000-8000-000000002026', m
from unnest(array['Alex', 'Curtis', 'Daniel', 'Darren', 'James', 'Kyle', 'Mookie']) as m
on conflict do nothing;

update public.seasons
set commissioner_team_id = (
  select id from public.fantasy_teams
  where season_id = '7ba99e70-0000-4000-8000-000000002026' and manager_name = 'Daniel'
)
where id = '7ba99e70-0000-4000-8000-000000002026';

insert into public.drafts (season_id, number, kind, fantasy_round, before_game_type)
values
  ('7ba99e70-0000-4000-8000-000000002026', 1, 'initial', 1, 'F'),
  ('7ba99e70-0000-4000-8000-000000002026', 2, 'redraft', 1, 'D'),
  ('7ba99e70-0000-4000-8000-000000002026', 3, 'redraft', 2, 'L'),
  ('7ba99e70-0000-4000-8000-000000002026', 4, 'redraft', 3, 'W')
on conflict do nothing;

alter publication supabase_realtime add table public.fantasy_teams, public.season_player_pool;
