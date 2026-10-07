-- Hitters an eliminated manager dropped go back in the draft pool (docs/RULES.md), so a player
-- can have more than one spell a season. He's still on one roster at a time: at most one spell
-- that hasn't been dropped.
alter table public.roster_spells drop constraint roster_spells_season_id_mlb_player_id_key;

create unique index roster_spells_one_roster on public.roster_spells (season_id, mlb_player_id)
  where dropped_by_draft_id is null;
