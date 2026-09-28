-- The ghost team (docs/RULES.md): the eliminated managers' team. The 2 managers out after round 1
-- give it 2 hitters at the end of Draft 3 and it plays the CS round (never cut); the 2 out after
-- round 2 join it in the Draft 4 snake, and it plays the finalists in round 3. The draft function
-- creates it when Draft 3 starts: a spot nobody manages, so it can't be claimed or assigned.

alter table public.fantasy_teams add column is_ghost boolean not null default false;
create unique index fantasy_teams_one_ghost on public.fantasy_teams (season_id) where is_ghost;

-- The ghost's turns in a draft, set when it starts: [{ "by": <manager's team id>, "kind": "add" | "redraft" }].
alter table public.drafts add column ghost_turns jsonb not null default '[]';

-- On a ghost pick: the eliminated manager's team whose turn it was.
alter table public.draft_actions add column by_team_id uuid references public.fantasy_teams (id) on delete set null;

create function private.ghost_team_unmanaged() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.user_id is not null or new.manager_id is not null or new.name is distinct from old.name then
    raise exception 'The ghost team can''t be claimed, assigned or renamed';
  end if;
  return new;
end;
$$;

create trigger fantasy_teams_ghost_unmanaged
  before update on public.fantasy_teams
  for each row when (old.is_ghost)
  execute function private.ghost_team_unmanaged();
