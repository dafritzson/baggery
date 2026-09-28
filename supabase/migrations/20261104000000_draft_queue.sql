-- Draft queues: a manager's ranked list of players for a draft, for when they can't be there.
-- Autodraft (their switch, or the commissioner's autopick) takes the first queued player still
-- available, before falling back to the most regular-season TB. In a redraft each entry can say
-- who to drop for him. A queue is private to its manager: other managers can't see it. It's
-- written through the draft function, like every other draft change.

create table public.draft_queue (
  draft_id uuid not null references public.drafts (id) on delete cascade,
  -- The team whose manager queued him: on a ghost turn, the eliminated manager making it.
  fantasy_team_id uuid not null references public.fantasy_teams (id) on delete cascade,
  -- 0-based, top of the queue first.
  position smallint not null,
  mlb_player_id integer not null references public.mlb_players (id),
  drop_player_id integer references public.mlb_players (id),
  primary key (draft_id, fantasy_team_id, mlb_player_id),
  unique (draft_id, fantasy_team_id, position)
);

alter table public.draft_queue enable row level security;
create policy "managers can read their own queue" on public.draft_queue
  for select to authenticated using (
    exists (select 1 from public.fantasy_teams t where t.id = fantasy_team_id and t.user_id = auth.uid())
  );
