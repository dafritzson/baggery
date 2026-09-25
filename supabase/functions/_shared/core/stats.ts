// Regular-season stats shown in the draft room's player table.

import { type StatLine, obp, slg } from './scoring.ts';

/** Season batting counts, enough for PA, SLG, OPS+ and the projections below. */
export interface BattingLine extends Pick<StatLine, 'ab' | 'h' | 'bb' | 'hbp' | 'sf' | 'tb'> {
  /** Games played. */
  g: number;
  pa: number;
}

const BATTING_KEYS: (keyof BattingLine)[] = ['g', 'pa', 'ab', 'h', 'bb', 'hbp', 'sf', 'tb'];

export function emptyBattingLine(): BattingLine {
  return { g: 0, pa: 0, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0 };
}

export function addBattingLines(lines: BattingLine[]): BattingLine {
  const total = emptyBattingLine();
  for (const line of lines) for (const k of BATTING_KEYS) total[k] += line[k];
  return total;
}

/** SLG, or null with no at-bats. */
export function seasonSlg(line: BattingLine): number | null {
  return line.ab === 0 ? null : slg(line);
}

/**
 * OPS+ = 100 × (OBP / league OBP + SLG / league SLG − 1), rounded. Like Baseball-Reference's,
 * but without the park adjustment. Null with no plate appearances.
 */
export function opsPlus(line: BattingLine, league: BattingLine): number | null {
  const lgObp = obp(league);
  const lgSlg = slg(league);
  if (line.pa === 0 || lgObp === 0 || lgSlg === 0) return null;
  return Math.round(100 * (obp(line) / lgObp + slg(line) / lgSlg - 1));
}

// Projections for fantasy round 1 (Wild Card + Division Series), from the league's draft sheet.
// "Regressed" stats add a fixed amount of league-average-ish performance to a player's season,
// so small samples count for less.

/** At-bats (for RDSLG) or games (for RDTB) of average performance added to every player. */
export const REGRESSION_WEIGHT = 200;
/** SLG that RDSLG regresses toward. */
export const REGRESSION_SLG = 0.435;
/** TB per game that RDTB regresses toward. */
export const REGRESSION_TB_PER_GAME = 1.5;
/** Expected games in a best-of-3 Wild Card series and a best-of-5 Division Series. */
const WILD_CARD_GAMES = 2.5;
const DIVISION_SERIES_GAMES = 4.125;
/** Chance a Wild Card team wins its series and plays the Division Series. */
const WILD_CARD_WIN_CHANCE = 0.5;

/**
 * Expected MLB games in fantasy round 1, if every game is a coin flip. A team with a bye plays
 * the best-of-5 Division Series (4.125 games). A team without one plays the best-of-3 Wild Card
 * (2.5 games) and reaches the Division Series half the time: 2.5 + 0.5 × 4.125 = 4.5625.
 */
export function expectedRound1Games(hasBye: boolean): number {
  return hasBye ? DIVISION_SERIES_GAMES : WILD_CARD_GAMES + WILD_CARD_WIN_CHANCE * DIVISION_SERIES_GAMES;
}

/** RDSLG: SLG regressed toward .435 by 200 at-bats. */
export function regressedSlg(tb: number, ab: number): number {
  return (tb + REGRESSION_WEIGHT * REGRESSION_SLG) / (ab + REGRESSION_WEIGHT);
}

/** RDTB: TB per game regressed toward 1.5 by 200 games, times expected round-1 games. */
export function regressedTb(tb: number, games: number, hasBye: boolean): number {
  return ((tb + REGRESSION_WEIGHT * REGRESSION_TB_PER_GAME) * expectedRound1Games(hasBye)) / (games + REGRESSION_WEIGHT);
}

/** "TB·E[G]/162": TB per game times expected round-1 games. Null with no games. */
export function expectedTb(tb: number, games: number, hasBye: boolean): number | null {
  return games === 0 ? null : (tb * expectedRound1Games(hasBye)) / games;
}

export interface StandingsTeam {
  teamId: number;
  league: 'AL' | 'NL';
  /** 1 = leads (or won) its division. */
  divisionRank: number;
  /** Rank within the league, with MLB's tiebreakers applied. */
  leagueRank: number;
}

/** Teams with a Wild Card bye: the two best division winners in each league. */
export function byeTeamIds(teams: StandingsTeam[]): Set<number> {
  const byes = new Set<number>();
  for (const league of ['AL', 'NL'] as const) {
    teams
      .filter((t) => t.league === league && t.divisionRank === 1)
      .sort((a, b) => a.leagueRank - b.leagueRank)
      .slice(0, 2)
      .forEach((t) => byes.add(t.teamId));
  }
  return byes;
}
