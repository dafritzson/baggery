// Regular-season stats shown in the draft room's player table.

import { type StatLine, obp, slg } from './scoring.ts';

/** Season batting counts, enough for PA, SLG and OPS+. */
export interface BattingLine extends Pick<StatLine, 'ab' | 'h' | 'bb' | 'hbp' | 'sf' | 'tb'> {
  pa: number;
}

const BATTING_KEYS: (keyof BattingLine)[] = ['pa', 'ab', 'h', 'bb', 'hbp', 'sf', 'tb'];

export function emptyBattingLine(): BattingLine {
  return { pa: 0, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0 };
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
