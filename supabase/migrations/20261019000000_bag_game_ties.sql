-- The bag game's league record goes to the last player to reach it: tying your own best now
-- refreshes its scored_at, and the app reads the latest row of a tied top score.

create or replace function public.record_bag_game(p_score int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your score';
  end if;
  insert into public.bag_game_bests (user_id, score) values (auth.uid(), p_score)
  on conflict (user_id) do update set score = excluded.score, scored_at = now()
  where excluded.score >= public.bag_game_bests.score;
end;
$$;
