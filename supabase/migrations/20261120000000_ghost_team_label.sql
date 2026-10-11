-- The name alerts show for a team: the ghost is a 👻 per manager behind it (whoever has had a
-- ghost turn this season, like the app's ghostManagers), so 👻👻 in round 2.
create or replace function private.team_label(p_team_id uuid) returns text
language sql stable
set search_path = ''
as $$
  select case
    when t.is_ghost then repeat('👻', greatest(1, (
      select count(distinct g ->> 'by')::int from public.drafts d
      cross join jsonb_array_elements(d.ghost_turns) g
      where d.season_id = t.season_id)))
    else coalesce(t.name, 'Team ' || t.slot)
  end
  from public.fantasy_teams t where t.id = p_team_id;
$$;

revoke execute on function private.team_label from anon, authenticated, public;

-- No manager's team can pass for the ghost under its new name either: nothing but 👻s (spaces and
-- the emoji's invisible variation selector aside).
create or replace function private.ghost_name_reserved() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if lower(replace(new.name, U&'\FE0F', '')) = lower('👻 Ghost')
     or replace(replace(replace(new.name, U&'\FE0F', ''), ' ', ''), '👻', '') = '' then
    raise exception 'That name belongs to the ghost team';
  end if;
  return new;
end;
$$;
