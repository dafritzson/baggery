-- Hitters on a playoff team's injured list who could come off it before the postseason ends. They
-- aren't on the active roster (on_postseason_roster is false), but Draft 1 lets managers take
-- them, marked as injured. Filled in by sync-pool; null when he isn't on the injured list.

alter table public.season_player_pool
  -- The list he's on: 7, 10, 15 or 60 days.
  add column injured_list smallint check (injured_list in (7, 10, 15, 60)),
  -- MLB's note, like 'Right calf strain.'
  add column injury text,
  -- The first day he can come off it. Null when his placement wasn't found.
  add column injury_return date;
