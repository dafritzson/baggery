-- The Games tab's live details, from the MLB linescore: inning, count, outs, runners, and who's
-- batting and due up for each team. Written by poll-games while a game is live and just after.
-- Shape: see LiveState in supabase/functions/poll-games/feed.ts.
alter table public.mlb_games add column live jsonb;
