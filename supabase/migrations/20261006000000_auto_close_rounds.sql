-- Rounds close themselves (poll-games): once every MLB series in a fantasy round has a winner and
-- 3 hours have passed for stat corrections, the teams below the cut are eliminated, unless a full
-- tie at the cut needs the commissioner's drink-off. A round the commissioner reopens is left for
-- them to close again: its number goes here so the poller doesn't close it straight back.
alter table public.seasons add column manual_rounds smallint[] not null default '{}';
