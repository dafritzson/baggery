// Closing a fantasy round: the teams below the cut (by TB, then the rules' tiebreakers) are
// eliminated. poll-games closes rounds by itself once every MLB series in the round has a winner
// and 3 hours have passed for stat corrections; a full tie at the cut (a drink-off) and a round
// the commissioner reopened are left for the commissioner (close-round).

import { roundDecided } from './core/scoreboard.ts';
import { eliminations, facesCut } from './core/scoring.ts';
import type { FantasyRound, TeamId } from './core/types.ts';
import type { Tx } from './db.ts';
import { UserError } from './http.ts';
import { roundGameTypes, roundRanking } from './round-ranking.ts';

/** How long after a round's last final game it closes by itself: the poller's stat-correction window. */
const SETTLE_MS = 3 * 60 * 60 * 1000;

export interface Season {
  id: string;
  year: number;
  survivors_after_round: number[];
  manual_rounds: number[];
}

export type CloseResult = { eliminated: TeamId[]; advancing: TeamId[] } | { drinkOff: { teamIds: TeamId[]; spots: number } };

/** Whether a round's MLB series all have winners, and when its last game was first seen final. */
export async function roundState(tx: Tx, season: Season, round: FantasyRound): Promise<{ decided: boolean; lastFinal: Date | null }> {
  const games = await tx`
    select game_type, home_team_id, away_team_id, status, home_score, away_score, games_in_series, final_seen_at
    from mlb_games where season_year = ${season.year} and game_type in ${tx(roundGameTypes(round))}`;
  const decided = roundDecided(
    round,
    games.map((g) => ({
      gameType: g.game_type,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      status: g.status,
      homeScore: g.home_score,
      awayScore: g.away_score,
      gamesInSeries: g.games_in_series,
    })),
  );
  const finals = games.filter((g) => g.status === 'Final');
  const lastFinal = finals.some((g) => !g.final_seen_at)
    ? null
    : finals.reduce<Date | null>((latest, g) => (!latest || g.final_seen_at > latest ? new Date(g.final_seen_at) : latest), null);
  return { decided, lastFinal };
}

/**
 * Closes `round`: eliminates the teams below the cut. A drink-off needs `drinkOffWinners`; without
 * them nothing is saved and the drink-off is returned. Throws when the round can't be closed.
 */
export async function closeRound(tx: Tx, season: Season, round: FantasyRound, drinkOffWinners?: TeamId[]): Promise<CloseResult> {
  const teams = await tx`select id, eliminated_after_round, is_ghost from fantasy_teams where season_id = ${season.id}`;
  const closed = (r: number) => teams.some((t) => t.eliminated_after_round === r);
  if (closed(round)) throw new UserError(`Round ${round} is already closed.`);
  if (round > 1 && !closed(round - 1)) throw new UserError(`Close round ${round - 1} first.`);
  if (!(await roundState(tx, season, round)).decided) throw new UserError(`Round ${round}'s series aren't all decided yet.`);

  // The ghost team plays round 2 but isn't cut until round 3, where it plays the finalists.
  const alive = teams.filter((t) => t.eliminated_after_round === null && facesCut({ isGhost: t.is_ghost }, round)).map((t) => t.id as string);
  const ranked = await roundRanking(tx, season, round, alive);
  const cut = eliminations(ranked, Math.min(season.survivors_after_round[round - 1] ?? 1, ranked.length));
  let { advancing, eliminated } = cut;
  if (cut.drinkOff) {
    const winners = drinkOffWinners ?? [];
    if (winners.length !== cut.drinkOff.spots || !winners.every((w) => cut.drinkOff!.teamIds.includes(w))) return { drinkOff: cut.drinkOff };
    advancing = [...advancing, ...winners];
    eliminated = [...eliminated, ...cut.drinkOff.teamIds.filter((t) => !winners.includes(t))];
  }
  if (eliminated.length) await tx`update fantasy_teams set eliminated_after_round = ${round} where id in ${tx(eliminated)}`;
  if (round === 3) await tx`update seasons set status = 'complete' where id = ${season.id}`;
  return { eliminated, advancing };
}

/**
 * Closes whatever rounds of the latest season are ready: decided, settled for 3 hours, not
 * reopened by the commissioner, and not a drink-off. Returns the rounds it closed.
 */
export async function autoCloseRounds(tx: Tx, now = new Date()): Promise<number[]> {
  const [season] = await tx<Season[]>`
    select id, year, survivors_after_round, manual_rounds from seasons
    where imported_at is null and status <> 'complete'
    order by year desc limit 1`;
  if (!season) return [];
  const closedNow: number[] = [];
  for (const round of [1, 2, 3] as FantasyRound[]) {
    const [done] = await tx`select 1 from fantasy_teams where season_id = ${season.id} and eliminated_after_round = ${round} limit 1`;
    if (done) continue;
    if (season.manual_rounds.includes(round)) break;
    if (round > 1 && !closedNow.includes(round - 1)) {
      const [previous] = await tx`select 1 from fantasy_teams where season_id = ${season.id} and eliminated_after_round = ${round - 1} limit 1`;
      if (!previous) break;
    }
    const state = await roundState(tx, season, round);
    if (!state.decided || !state.lastFinal || now.getTime() - state.lastFinal.getTime() < SETTLE_MS) break;
    const result = await closeRound(tx, season, round);
    if ('drinkOff' in result) break;
    closedNow.push(round);
  }
  return closedNow;
}
