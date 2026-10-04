// Busts and steals: each Draft 1 pick against the board he was picked from. A pick is scored by
// what his roster spot produced (his postseason bags, plus a replacement's after his MLB team is
// out) against the 3 best hitters still undrafted at that pick, whose spots are scored the same
// way. "Best" is ranked twice, by xBags at Draft 1's lock and by regular-season TB, and the two
// are averaged: the two rankings that best predict postseason bags (see docs/PLAN.md). A pick
// from the season being played counts once he and his alternatives are all out. Pure, so the
// unit tests can run it.

import { type NamedPitcher, expectedGames, roundMatchups } from './matchups.ts';
import { type OddsTeam, postseasonOdds } from './odds.ts';
import { type PlatoonRecord, expectedPaOver, recordSplits } from './platoon.ts';
import { expectedBags, regressedSlg } from './stats.ts';
import type { PlayerId } from './types.ts';

/** The redraft after which a hitter whose team went out can be replaced: Drafts 2, 3 and 4. */
export type Redraft = 2 | 3 | 4;

/** A season's MLB postseason team, as of Draft 1 (seeds are null before the pool sync had them). */
export interface BustTeam {
  teamId: number;
  league: 'AL' | 'NL' | null;
  seed: number | null;
  wins: number | null;
  rotation: NamedPitcher[] | null;
  /**
   * Out of the postseason: the redraft that could replace its hitters (a Wild Card exit at Draft
   * 2, a Division Series exit at Draft 3, a Championship Series exit at Draft 4), or null when it
   * went out in the World Series and there was none. Undefined while it's still playing.
   */
  replacedAt?: Redraft | null;
}

/** A pool hitter's regular season, the numbers xBags and TB rank the board by. */
export interface BustPlayer {
  playerId: PlayerId;
  mlbTeamId: number;
  tb: number;
  ab: number;
  pa: number;
  games: number;
  /** Only the weighted splits are used. */
  platoon: PlatoonRecord | null;
}

export interface BustSeason {
  seasonId: string;
  year: number;
  complete: boolean;
  /** Draft 1's lock: xBags is as of then. */
  lockedAt: string;
  teams: BustTeam[];
  /** Every pool hitter: the board. */
  players: BustPlayer[];
  /** Draft 1's picks in order, with the manager who made each. */
  picks: { managerKey: string; playerId: PlayerId }[];
  /** Each MLB team's postseason games played, when the seeds can't give expected games. */
  teamGamesPlayed: Map<number, number>;
  /** Every postseason total base each player scored, by player. */
  bags: Map<PlayerId, number>;
}

/** A Draft 1 pick against the board. */
export interface DraftBet {
  managerKey: string;
  year: number;
  playerId: PlayerId;
  /** Overall pick number in Draft 1, from 1. */
  pick: number;
  bags: number;
  /** His roster spot's value: his bags plus a replacement's after his team went out. */
  spot: number;
  /** What the board's best 3 would have produced in the spot, averaged over both rankings. */
  board: number;
  /** Spot minus board: most negative is the biggest bust. */
  diff: number;
  /** The hitters he was measured against: the best 3 by xBags, then by TB (no repeats). */
  alternatives: PlayerId[];
  /** From a season still being played (he and his alternatives are out, so it's final). */
  live: boolean;
}

/** How many of the best undrafted hitters a pick is measured against. */
export const BOARD_SIZE = 3;

/**
 * Replacement level: what a hitter added in each redraft went on to score, from that draft to the
 * end of the postseason, averaged over every add in finished seasons. Missing drafts get 0.
 */
export function replacementLevels(adds: { draft: number; bags: number }[]): Record<Redraft, number> {
  const level = (k: Redraft) => {
    const list = adds.filter((a) => a.draft === k);
    return list.length ? list.reduce((sum, a) => sum + a.bags, 0) / list.length : 0;
  };
  return { 2: level(2), 3: level(3), 4: level(4) };
}

/**
 * Expected postseason games for each team as of Draft 1. From the bracket odds when the seeds are a
 * full 6 per league; otherwise (2020 and 2021's formats, or a pool synced before seeds) every team
 * gets the same, that postseason's average games per team, which needs the postseason to be over.
 */
function expectedTeamGames(season: BustSeason): { games: Map<number, number>; field: OddsTeam[] } | null {
  const field = season.teams.flatMap((t) =>
    t.seed !== null && t.league !== null && t.wins !== null ? [{ teamId: t.teamId, league: t.league, seed: t.seed, wins: t.wins }] : [],
  );
  const odds = postseasonOdds(field, []);
  if (odds) return { games: new Map([...odds].map(([id, o]) => [id, o.games])), field };
  if (!season.complete || !season.teams.length) return null;
  const played = season.teams.reduce((sum, t) => sum + (season.teamGamesPlayed.get(t.teamId) ?? 0), 0);
  const average = played / season.teams.length;
  return average > 0 ? { games: new Map(season.teams.map((t) => [t.teamId, average])), field: [] } : null;
}

/** One player's xBags as of Draft 1, or null without the numbers for it. */
export function draftXBags(
  player: BustPlayer,
  teamGames: number,
  field: OddsTeam[],
  rotations: Map<number, NamedPitcher[]>,
  lockedAt: number,
): number | null {
  if (!player.ab || !player.games) return null;
  // Platoon-aware, as the draft table has it: his plate appearances from his starts and lineup
  // spot against each hand, and his team's likely Wild Card and Division Series starters.
  if (player.platoon && player.pa && field.length && rotations.size) {
    const matchups = roundMatchups(player.mlbTeamId, { field, series: [], rotations, probables: new Map() });
    const perPa = (regressedSlg(player.tb, player.ab) * player.ab) / player.pa;
    return perPa * expectedPaOver(recordSplits(player.platoon), expectedGames(matchups, lockedAt), teamGames);
  }
  return expectedBags(player.tb, player.ab, player.games, teamGames);
}

/** Every Draft 1 pick whose result is final, against the board. */
export function draftBets(seasons: BustSeason[], replacement: Record<Redraft, number>): DraftBet[] {
  const bets: DraftBet[] = [];
  for (const season of seasons) {
    const expected = expectedTeamGames(season);
    if (!expected) continue;
    const teams = new Map(season.teams.map((t) => [t.teamId, t]));
    const players = new Map(season.players.map((p) => [p.playerId, p]));
    const rotations = new Map(season.teams.flatMap((t) => (t.rotation ? [[t.teamId, t.rotation] as const] : [])));
    const lockedAt = Date.parse(season.lockedAt);

    // The two rankings of the board, best first.
    const xBags = new Map<PlayerId, number>();
    for (const p of season.players) {
      const games = expected.games.get(p.mlbTeamId);
      const x = games === undefined ? null : draftXBags(p, games, expected.field, rotations, lockedAt);
      if (x !== null) xBags.set(p.playerId, x);
    }
    const rankings: PlayerId[][] = [
      // Ties go to the lower MLB id, so the board doesn't depend on the order rows arrive in.
      [...xBags].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id),
      season.players.filter((p) => p.ab > 0 && teams.has(p.mlbTeamId)).sort((a, b) => b.tb - a.tb || a.playerId - b.playerId).map((p) => p.playerId),
    ];

    const team = (id: PlayerId) => teams.get(players.get(id)?.mlbTeamId ?? -1);
    const final = (id: PlayerId) => season.complete || team(id)?.replacedAt !== undefined;
    const spot = (id: PlayerId) => {
      const at = team(id)?.replacedAt;
      return (season.bags.get(id) ?? 0) + (at ? replacement[at] : 0);
    };

    const taken = new Set<PlayerId>();
    season.picks.forEach((pick, i) => {
      const boards = rankings.map((ranking) => ranking.filter((id) => !taken.has(id) && id !== pick.playerId).slice(0, BOARD_SIZE));
      taken.add(pick.playerId);
      if (!players.has(pick.playerId) || boards.some((b) => !b.length)) return;
      const alternatives = [...new Set(boards.flat())];
      if (!final(pick.playerId) || !alternatives.every(final)) return;
      const value = spot(pick.playerId);
      const board = boards.reduce((sum, b) => sum + b.reduce((s, id) => s + spot(id), 0) / b.length, 0) / boards.length;
      bets.push({
        managerKey: pick.managerKey,
        year: season.year,
        playerId: pick.playerId,
        pick: i + 1,
        bags: season.bags.get(pick.playerId) ?? 0,
        spot: value,
        board,
        diff: value - board,
        alternatives,
        live: !season.complete,
      });
    });
  }
  return bets;
}

/** The biggest busts (furthest below the board) and steals (furthest above), `top` of each. */
export function bustsAndSteals(bets: DraftBet[], top = 20): { busts: DraftBet[]; steals: DraftBet[] } {
  return {
    busts: bets.filter((b) => b.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, top),
    steals: bets.filter((b) => b.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, top),
  };
}
