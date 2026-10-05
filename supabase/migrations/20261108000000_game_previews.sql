-- For the Games tab's cards of games still to come: the ballpark, and each announced starter's
-- numbers. Neither is in the scores load; the cards read them with the starters.

-- "Truist Park · Atlanta". Every mlb_games change is broadcast whole, so it's kept short.
alter table public.mlb_games
  add column venue text;

-- { "era": "2.49" | null, "post": { "w", "l", "era", "ip", "k" } | null }: regular-season ERA and
-- this postseason's line. poll-games fills it when a starter is announced and refreshes it every
-- few hours until the game starts.
alter table public.mlb_probables
  add column stats jsonb,
  add column stats_at timestamptz;
