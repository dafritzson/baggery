-- A hitter whose MLB team is eliminated leaves every fantasy roster right then, keeping the bags
-- he earned: his spot is empty (docs/RULES.md). His spell ends (to_at) without a drop, so a
-- closed spell with no dropped_by_draft_id is one that ended this way. Reinstating a team (a
-- mistake fixed) puts its hitters back.
create function public.out_hitters_leave_rosters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.eliminated and not old.eliminated then
    update public.roster_spells r set to_at = greatest(now(), r.from_at)
    from public.season_player_pool p
    where p.season_id = new.season_id and p.mlb_team_id = new.mlb_team_id
      and r.season_id = new.season_id and r.mlb_player_id = p.mlb_player_id and r.to_at is null;
  elsif old.eliminated and not new.eliminated then
    update public.roster_spells r set to_at = null
    from public.season_player_pool p
    where p.season_id = new.season_id and p.mlb_team_id = new.mlb_team_id
      and r.season_id = new.season_id and r.mlb_player_id = p.mlb_player_id
      and r.to_at is not null and r.dropped_by_draft_id is null;
  end if;
  return new;
end $$;

create trigger out_hitters_leave_rosters after update of eliminated on public.season_mlb_teams
  for each row execute function public.out_hitters_leave_rosters();

-- This season's hitters already out leave now. Past seasons stay as they were imported.
update public.roster_spells r set to_at = greatest(now(), r.from_at)
from public.season_player_pool p
join public.season_mlb_teams t on t.season_id = p.season_id and t.mlb_team_id = p.mlb_team_id
join public.seasons s on s.id = p.season_id
where s.status <> 'complete' and t.eliminated
  and r.season_id = p.season_id and r.mlb_player_id = p.mlb_player_id and r.to_at is null;
