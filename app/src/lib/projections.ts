import { type TeamOdds, postseasonOdds } from '@core/odds.ts';
import { postseasonSeries } from '@core/schedule.ts';
import type { GameInfo } from '@core/score-feed.ts';
import { expectedTb, regressedSlg, regressedTb } from '@core/stats.ts';

import { oddsField } from '@/lib/platoon';
import type { PoolEntry, SeasonData } from '@/lib/season';

/** A pool player's round-1 projections, as the draft table and the player popup show them. */
export interface Projection {
  /** His team has a Wild Card bye. */
  bye: boolean;
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
    rdslg: entry.at_bats === null ? null : regressedSlg(tb, entry.at_bats),
    tbExpected: g === null ? null : expectedTb(tb, g, bye),
    rdtb: g === null ? null : regressedTb(tb, g, bye),
  };
}

/**
 * Each postseason team's odds from here on (core/odds.ts), from its seed and record and the
 * series so far: counting only games that started before `before` when given (a finished draft's
 * lock). Null until the pool sync has set a full 6 seeds per league.
 */
export function teamOdds(data: SeasonData, games: GameInfo[], before?: string | null): Map<number, TeamOdds> | null {
  const teams = oddsField(data);
  const cut = before ? Date.parse(before) : Infinity;
  return postseasonOdds(teams, postseasonSeries(games.filter((g) => Date.parse(g.start) < cut)));
}
