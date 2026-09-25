-- The Home screen's bag-catching game (app/src/lib/bag-game.ts): each player's best score.
-- The league record is the top row (earliest wins a tie).

create table public.bag_game_bests (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 69 is a perfect game: every bag caught (PERFECT_SCORE in bag-game.ts).
  score int not null check (score between 0 and 69),
  scored_at timestamptz not null default now()
);

alter table public.bag_game_bests enable row level security;
create policy "signed-in users can read" on public.bag_game_bests for select to authenticated using (true);
grant select on public.bag_game_bests to authenticated;

-- A finished game. Keeps the player's best; a lower score changes nothing.
create function public.record_bag_game(p_score int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your score';
  end if;
  insert into public.bag_game_bests (user_id, score) values (auth.uid(), p_score)
  on conflict (user_id) do update set score = excluded.score, scored_at = now()
  where excluded.score > public.bag_game_bests.score;
end;
$$;

revoke execute on function public.record_bag_game from anon, public;
grant execute on function public.record_bag_game to authenticated;
