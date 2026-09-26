-- The commissioner links a past manager (a first name from the old sheets) to someone's account.
-- Every past team of that manager then belongs to the account, so it shows as theirs (photo,
-- "You") in every imported season. Seasons imported later pick the link up too. Null unlinks.
create function public.link_manager(p_manager_id uuid, p_user_id uuid) returns void
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
  update public.fantasy_teams set user_id = p_user_id where manager_id = p_manager_id;
end;
$$;

revoke execute on function public.link_manager from anon, public;
grant execute on function public.link_manager to authenticated;
