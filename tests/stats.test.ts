import { describe, expect, it } from 'vitest';
import {
  type BattingLine,
  type StandingsTeam,
  addBattingLines,
  byeTeamIds,
  emptyBattingLine,
  opsPlus,
  seasonSlg,
} from '../supabase/functions/_shared/core/stats.ts';

function line(s: Partial<BattingLine>): BattingLine {
  return { ...emptyBattingLine(), ...s };
}

describe('addBattingLines', () => {
  it('sums every count (a traded player’s splits)', () => {
    const total = addBattingLines([
      line({ pa: 300, ab: 260, h: 70, bb: 30, hbp: 5, sf: 5, tb: 120 }),
      line({ pa: 200, ab: 180, h: 50, bb: 15, hbp: 2, sf: 3, tb: 90 }),
    ]);
    expect(total).toEqual({ pa: 500, ab: 440, h: 120, bb: 45, hbp: 7, sf: 8, tb: 210 });
  });
});

describe('seasonSlg', () => {
  it('is TB per at-bat', () => {
    expect(seasonSlg(line({ pa: 10, ab: 8, tb: 4 }))).toBe(0.5);
  });
  it('is null with no at-bats', () => {
    expect(seasonSlg(line({ pa: 2, bb: 2 }))).toBeNull();
  });
});

describe('opsPlus', () => {
  // League: OBP .300 (300 on base / 1000 PA), SLG .400 (360 TB / 900 AB).
  const league = line({ pa: 1000, ab: 900, h: 250, bb: 50, hbp: 0, sf: 50, tb: 360 });

  it('is 100 for a league-average hitter', () => {
    expect(opsPlus(league, league)).toBe(100);
  });

  it('adds OBP and SLG relative to league', () => {
    // OBP .450 (1.5× league), SLG .600 (1.5× league): 100 × (1.5 + 1.5 − 1) = 200.
    const star = line({ pa: 100, ab: 90, h: 40, bb: 5, hbp: 0, sf: 5, tb: 54 });
    expect(opsPlus(star, league)).toBe(200);
  });

  it('is null with no plate appearances', () => {
    expect(opsPlus(emptyBattingLine(), league)).toBeNull();
  });

  it('is null without league stats', () => {
    expect(opsPlus(line({ pa: 4, ab: 4, h: 1, tb: 1 }), emptyBattingLine())).toBeNull();
  });
});

describe('byeTeamIds', () => {
  const t = (teamId: number, league: 'AL' | 'NL', divisionRank: number, leagueRank: number): StandingsTeam => ({
    teamId,
    league,
    divisionRank,
    leagueRank,
  });

  it('gives byes to the two best division winners in each league', () => {
    const byes = byeTeamIds([
      t(1, 'AL', 1, 1),
      t(2, 'AL', 2, 2), // best record but not a division winner: no bye
      t(3, 'AL', 1, 3),
      t(4, 'AL', 1, 4),
      t(5, 'NL', 1, 2),
      t(6, 'NL', 1, 1),
      t(7, 'NL', 1, 5),
    ]);
    expect([...byes].sort()).toEqual([1, 3, 5, 6]);
  });
});
