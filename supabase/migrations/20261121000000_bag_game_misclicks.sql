-- The bag game's first tiebreaker: misclicks, the taps that caught nothing (a perfect game has 0).
-- Records rank by bags, then fewer misclicks, then the most recent run. Bests saved before misclicks
-- were counted get 1000 (UNCOUNTED_MISCLICKS in bag-game.ts), so any new game that ties one of them
-- on bags wins.

alter table public.bag_game_bests add column misclicks int not null default 1000 check (misclicks >= 0);

drop function public.record_bag_game(int);

-- A finished game. Counts it, and keeps the player's best: more bags, or the same bags and no more
-- misclicks (a full tie refreshes it: the last to reach a tied record holds it). Every right-hand
-- side reads the row as it was, so each column tests the same "better". An app from before this
-- sends no misclicks, so its games count as 1000.
create function public.record_bag_game(p_score int, p_misclicks int default 1000) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your score';
  end if;
  insert into public.bag_game_bests (user_id, score, misclicks) values (auth.uid(), p_score, p_misclicks)
  on conflict (user_id) do update set
    games = public.bag_game_bests.games + 1,
    score = case
      when excluded.score > public.bag_game_bests.score
        or (excluded.score = public.bag_game_bests.score and excluded.misclicks <= public.bag_game_bests.misclicks)
      then excluded.score else public.bag_game_bests.score end,
    misclicks = case
      when excluded.score > public.bag_game_bests.score
        or (excluded.score = public.bag_game_bests.score and excluded.misclicks <= public.bag_game_bests.misclicks)
      then excluded.misclicks else public.bag_game_bests.misclicks end,
    scored_at = case
      when excluded.score > public.bag_game_bests.score
        or (excluded.score = public.bag_game_bests.score and excluded.misclicks <= public.bag_game_bests.misclicks)
      then now() else public.bag_game_bests.scored_at end;
end;
$$;

revoke execute on function public.record_bag_game from anon, public;
grant execute on function public.record_bag_game to authenticated;
