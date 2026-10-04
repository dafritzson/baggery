// Busts and steals: Draft 1 picks against what the draft room expected of them. Each pick's xBags
// is worked out as of Draft 1's lock, the way the draft table had it (platoon-aware when the pool
// has lineups, else RDSLG × at-bats per game × team games), and compared with the bags he scored
// that postseason, every game, whoever had him by then. A pick counts once his total is final:
// his MLB team is out, or the season is over. Pure, so the unit tests can run it.

import { type NamedPitcher, expectedGames, roundMatchups } from './matchups.ts';
import { type OddsTeam, postseasonOdds } from './odds.ts';
import { type PlatoonRecord, expectedPaOver, recordSplits } from './platoon.ts';
import { expectedBags, regressedSlg } from './stats.ts';
import type { PlayerId } from './types.ts';

/** A season's MLB postseason team, as of Draft 1 (seeds are null before the pool sync had them). */
export interface BustTeam {
  teamId: number;
  league: 'AL' | 'NL' | null;
  seed: number | null;
  wins: number | null;
  /** Out of the postseason: its hitters' totals are final. */
  eliminated: boolean;
  rotation: NamedPitcher[] | null;
}

/** A pool player's regular season, the numbers xBags takes. */
export interface BustPlayer {
  playerId: PlayerId;
  mlbTeamId: number;
  tb: number;
  ab: number;
  pa: number;
  games: number;
  platoon: PlatoonRecord | null;
}

export interface BustSeason {
  seasonId: string;
  year: number;
  complete: boolean;
  /** Draft 1's lock: xBags is as of then. */
  lockedAt: string;
  teams: BustTeam[];
  players: BustPlayer[];
  /** Draft 1's picks in order, with the manager who made each. */
  picks: { managerKey: string; playerId: PlayerId }[];
  /** Each MLB team's postseason games played, when the seeds can't give expected games. */
  teamGamesPlayed: Map<number, number>;
  /** Every postseason total base each player scored, by player. */
  bags: Map<PlayerId, number>;
}

/** A Draft 1 pick against what was expected of him. */
export interface DraftBet {
  managerKey: string;
  year: number;
  playerId: PlayerId;
  /** Overall pick number in Draft 1, from 1. */
  pick: number;
  xBags: number;
  bags: number;
  /** Bags minus xBags: most negative is the biggest bust. */
  diff: number;
  /** From a season still being played (his team is out, so the total is final). */
  live: boolean;
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

/** Every Draft 1 pick whose total is final, with its xBags and bags. */
export function draftBets(seasons: BustSeason[]): DraftBet[] {
  const bets: DraftBet[] = [];
  for (const season of seasons) {
    const expected = expectedTeamGames(season);
    if (!expected) continue;
    const teams = new Map(season.teams.map((t) => [t.teamId, t]));
    const players = new Map(season.players.map((p) => [p.playerId, p]));
    const rotations = new Map(season.teams.flatMap((t) => (t.rotation ? [[t.teamId, t.rotation] as const] : [])));
    season.picks.forEach((pick, i) => {
      const player = players.get(pick.playerId);
      const team = player && teams.get(player.mlbTeamId);
      const games = player && expected.games.get(player.mlbTeamId);
      if (!player || !team || games === undefined) return;
      if (!season.complete && !team.eliminated) return;
      const xBags = draftXBags(player, games, expected.field, rotations, Date.parse(season.lockedAt));
      if (xBags === null) return;
      const bags = season.bags.get(pick.playerId) ?? 0;
      bets.push({ managerKey: pick.managerKey, year: season.year, playerId: pick.playerId, pick: i + 1, xBags, bags, diff: bags - xBags, live: !season.complete });
    });
  }
  return bets;
}

/** The biggest busts (furthest below their xBags) and steals (furthest above), `top` of each. */
export function bustsAndSteals(bets: DraftBet[], top = 20): { busts: DraftBet[]; steals: DraftBet[] } {
  return {
    busts: bets.filter((b) => b.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, top),
    steals: bets.filter((b) => b.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, top),
  };
}
