import { expectedRound1Games, expectedTb, regressedSlg, regressedTb } from '@core/stats.ts';

import type { PoolEntry, SeasonData } from '@/lib/season';

/** A pool player's round-1 projections, as the draft table and the player popup show them. */
export interface Projection {
  /** His team has a Wild Card bye. */
  bye: boolean;
  /** MLB games his team is expected to play in fantasy round 1. */
  games: number;
  rdslg: number | null;
  tbExpected: number | null;
  rdtb: number | null;
}

export function projection(data: SeasonData, entry: PoolEntry): Projection {
  const bye = data.mlbTeams.get(entry.mlb_team_id)?.has_bye ?? false;
  const tb = entry.regular_season_tb;
  const g = entry.games_played;
  return {
    bye,
    games: expectedRound1Games(bye),
    rdslg: entry.at_bats === null ? null : regressedSlg(tb, entry.at_bats),
    tbExpected: g === null ? null : expectedTb(tb, g, bye),
    rdtb: g === null ? null : regressedTb(tb, g, bye),
  };
}
