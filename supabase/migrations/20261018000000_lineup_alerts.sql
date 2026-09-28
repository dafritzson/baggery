-- Lineup alerts, off by default (Settings turns them on): "📋 Los Angeles Dodgers lineup is in" /
-- "Mookie Betts leading off, Freddie Freeman batting 3rd · Will Smith on the bench 🪑" when a team
-- posts its starting lineup for a postseason game, naming the drafted hitters in it and on its
-- bench; and "🪑 Freddie Freeman is out of the lineup" when a posted lineup drops one before first
-- pitch. poll-games reads the lineups with the schedule it already reads (hydrate=lineups).

alter table public.push_subscriptions
  add column lineup_alerts boolean not null default false;

-- Each team's starting lineup for an upcoming game as last seen, leadoff first, so a lineup
-- alerts once when it's posted and a later change can be told apart.
create table private.lineups (
  game_pk integer not null references public.mlb_games (game_pk) on delete cascade,
  mlb_team_id integer not null,
  player_ids integer[] not null,
  updated_at timestamptz not null default now(),
  primary key (game_pk, mlb_team_id)
);
