-- Videos of the bags. Every hit's play has a play ID, and Baseball Savant has a video of every
-- pitch by it; MLB also posts official highlight clips of many hits (most home runs), whose guid
-- is the play ID. poll-games reads each game's play-by-play when its box score has new hits, and
-- its highlights until the clips turn up. The Games tab's ▶ on a hitter lists his hits' videos.

create table public.mlb_hits (
  play_id uuid primary key,
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  mlb_player_id integer not null,
  event text not null check (event in ('1B', '2B', '3B', 'HR')),
  inning smallint not null,
  top_inning boolean not null,
  ended_at timestamptz,
  -- MLB's official clip (mlb.com/video/<slug>), once one is posted.
  clip_slug text,
  clip_headline text
);

create index mlb_hits_game_player on public.mlb_hits (game_pk, mlb_player_id);

alter table public.mlb_hits enable row level security;
create policy "signed-in users can read" on public.mlb_hits for select to authenticated using (true);
grant select on public.mlb_hits to authenticated;

-- When the poller last read each game's play-by-play and highlights.
create table private.video_reads (
  game_pk integer primary key references public.mlb_games (game_pk) on delete cascade,
  plays_read_at timestamptz,
  clips_read_at timestamptz
);
