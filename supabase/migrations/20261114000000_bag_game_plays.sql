-- The bag game counts each player's finished games, for "You've played N times" on the final
-- screen. Nothing counted games before this, so existing players start at 1 until their counts
-- are filled in from the API logs.

alter table public.bag_game_bests add column games int not null default 1 check (games >= 1);

-- A finished game. Counts it, and keeps the player's best: a lower score only adds to the count.
create or replace function public.record_bag_game(p_score int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your score';
  end if;
  insert into public.bag_game_bests (user_id, score) values (auth.uid(), p_score)
  on conflict (user_id) do update set
    games = public.bag_game_bests.games + 1,
    score = greatest(public.bag_game_bests.score, excluded.score),
    -- Tying your own best refreshes it: the last to reach a tied record holds it.
    scored_at = case when excluded.score >= public.bag_game_bests.score then now() else public.bag_game_bests.scored_at end;
end;
$$;
