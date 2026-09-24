import { describe, expect, it } from 'vitest';
import {
  type PlayerGameStat,
  type RosterSpell,
  type TeamTotals,
  eliminations,
  emptyTotals,
  obp,
  rankTeams,
  slg,
  teamRoundTotals,
} from '../supabase/functions/_shared/core/scoring.ts';

function stat(playerId: number, gameType: PlayerGameStat['gameType'], gameStart: string, s: Partial<PlayerGameStat>): PlayerGameStat {
  return { playerId, gameType, gameStart, ab: 0, h: 0, bb: 0, hbp: 0, sf: 0, tb: 0, hr: 0, r: 0, rbi: 0, ...s };
}

function totals(teamId: string, s: Partial<TeamTotals>): TeamTotals {
  return { ...emptyTotals(teamId), ...s };
}

describe('teamRoundTotals', () => {
  const draft1 = '2026-09-29T00:00:00Z';
  const draft2 = '2026-10-03T00:00:00Z'; // DS first pitch
  const spells: RosterSpell[] = [
    // Player 1 is on A for the Wild Card, then dropped before the DS.
    { teamId: 'A', playerId: 1, from: draft1, to: draft2 },
    { teamId: 'A', playerId: 2, from: draft2, to: null },
    { teamId: 'B', playerId: 3, from: draft1, to: null },
  ];

  it('keeps stats earned before a player was dropped (the 9 TB rule)', () => {
    const stats = [
      stat(1, 'F', '2026-09-30T18:00:00Z', { tb: 9, ab: 4 }),
      stat(2, 'D', '2026-10-04T18:00:00Z', { tb: 2, ab: 4 }),
    ];
    const [a] = teamRoundTotals(1, ['A', 'B'], spells, stats);
    expect(a.tb).toBe(11);
  });

  it('ignores games before a player joined', () => {
    const stats = [stat(2, 'F', '2026-09-30T18:00:00Z', { tb: 4 })];
    expect(teamRoundTotals(1, ['A'], spells, stats)[0].tb).toBe(0);
  });

  it('only counts games from the requested round', () => {
    const stats = [
      stat(3, 'D', '2026-10-04T18:00:00Z', { tb: 3 }),
      stat(3, 'L', '2026-10-12T18:00:00Z', { tb: 5 }),
    ];
    const byRound = (r: 1 | 2) => teamRoundTotals(r, ['B'], spells, stats)[0].tb;
    expect(byRound(1)).toBe(3);
    expect(byRound(2)).toBe(5);
  });
});

describe('rate stats', () => {
  it('computes team-total SLG and OBP', () => {
    const t = totals('A', { ab: 10, h: 3, bb: 1, hbp: 1, sf: 0, tb: 6 });
    expect(slg(t)).toBeCloseTo(0.6);
    expect(obp(t)).toBeCloseTo(5 / 12);
  });

  it('is 0 with no plate appearances', () => {
    expect(slg(emptyTotals('A'))).toBe(0);
    expect(obp(emptyTotals('A'))).toBe(0);
  });
});

describe('rankTeams', () => {
  it('ranks by TB first', () => {
    const ranked = rankTeams([totals('A', { tb: 5 }), totals('B', { tb: 9 })]);
    expect(ranked.map((t) => [t.teamId, t.rank])).toEqual([['B', 1], ['A', 2]]);
  });

  it('breaks TB ties with SLG, then OBP, HR, R, RBI', () => {
    const ranked = rankTeams([
      totals('slg', { tb: 10, ab: 20 }), // .500
      totals('best', { tb: 10, ab: 10 }), // 1.000
      totals('rbi', { tb: 10, ab: 20, rbi: 3 }),
    ]);
    expect(ranked.map((t) => t.teamId)).toEqual(['best', 'rbi', 'slg']);
  });

  it('gives fully tied teams the same rank', () => {
    const ranked = rankTeams([totals('A', { tb: 5 }), totals('B', { tb: 5 }), totals('C', { tb: 1 })]);
    expect(ranked.map((t) => t.rank)).toEqual([1, 1, 3]);
  });
});

describe('eliminations', () => {
  it('cuts cleanly when there is no tie at the line', () => {
    const ranked = rankTeams([1, 2, 3, 4, 5, 6, 7].map((tb) => totals(`T${tb}`, { tb })));
    const result = eliminations(ranked, 5);
    expect(result.eliminated.sort()).toEqual(['T1', 'T2']);
    expect(result.drinkOff).toBeNull();
  });

  it('sends a 3-way tie across the cut line to a drink-off', () => {
    const ranked = rankTeams([
      totals('A', { tb: 9 }),
      totals('B', { tb: 5 }),
      totals('C', { tb: 5 }),
      totals('D', { tb: 5 }),
      totals('E', { tb: 1 }),
    ]);
    const result = eliminations(ranked, 3);
    expect(result.advancing).toEqual(['A']);
    expect(result.eliminated).toEqual(['E']);
    expect(result.drinkOff).toEqual({ teamIds: ['B', 'C', 'D'], spots: 2 });
  });
});
