-- Savant publishes its play videos in a batch 13–25 hours after a game, not live, and a link
-- before then says "No Video Found". poll-games now checks one hit's Savant page per finished game
-- (hourly, from 12 hours after first pitch) and marks the game's hits once the video is up; the
-- Games tab's ▶ sheet only shows Savant links for hits marked ready.

alter table public.mlb_hits add column savant_ready boolean not null default false;

alter table private.video_reads
  add column savant_checked_at timestamptz,
  add column savant_checks integer not null default 0;
