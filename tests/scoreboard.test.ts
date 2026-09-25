import { describe, expect, it } from 'vitest';

import {
  type ScoreGame,
  currentRound,
  roundColumns,
  roundStandings,
  roundTotals,
  teamSeriesBlocks,
} from '../supabase/functions/_shared/core/scoreboard.ts';
import type { RosterSpell } from '../supabase/functions/_shared/core/scoring.ts';

// NYY (147) vs BOS (111) in the Wild Card, then NYY vs TOR (141) in the Division Series.
const games: ScoreGame[] = [
  { gamePk: 1, gameType: 'F', seriesGameNumber: 1, start: '2026-09-29T22:00:00Z', status: 'Final', homeTeamId: 147, awayTeamId: 111 },
  { gamePk: 2, gameType: 'F', seriesGameNumber: 2, start: '2026-09-30T22:00:00Z', status: 'Final', homeTeamId: 147, awayTeamId: 111 },
  { gamePk: 3, gameType: 'D', seriesGameNumber: 1, start: '2026-10-04T22:00:00Z', status: 'Live', homeTeamId: 141, awayTeamId: 147 },
  { gamePk: 4, gameType: 'D', seriesGameNumber: 2, start: '2026-10-05T22:00:00Z', status: 'Preview', homeTeamId: 141, awayTeamId: 147 },
];
const JUDGE = 592450; // NYY
const DEVERS = 646240; // BOS
const GUERRERO = 665489; // TOR
const mlbTeam: Record<number, number> = { [JUDGE]: 147, [DEVERS]: 111, [GUERRERO]: 141 };

const spells: RosterSpell[] = [
  { teamId: 'A', playerId: JUDGE, from: '2026-09-28T00:00:00Z', to: null },
  // Devers is dropped for Guerrero in the Division Series redraft.
  { teamId: 'B', playerId: DEVERS, from: '2026-09-28T00:00:00Z', to: '2026-10-04T22:00:00Z' },
  { teamId: 'B', playerId: GUERRERO, from: '2026-10-04T22:00:00Z', to: null },
];
const stats = [
  { gamePk: 1, playerId: JUDGE, tb: 5 },
  { gamePk: 1, playerId: DEVERS, tb: 2 },
  { gamePk: 2, playerId: JUDGE, tb: 0 },
  { gamePk: 2, playerId: DEVERS, tb: 4 },
  { gamePk: 3, playerId: JUDGE, tb: 1 },
  { gamePk: 3, playerId: GUERRERO, tb: 8 },
];

describe('scoreboard', () => {
  it('has a column per possible game of each series in the round', () => {
    const columns = roundColumns(1, games);
    expect(columns.map((c) => c.label)).toEqual(['WC1', 'WC2', 'WC3', 'DS1', 'DS2', 'DS3', 'DS4', 'DS5']);
    expect(columns.filter((c) => c.started).map((c) => c.label)).toEqual(['WC1', 'WC2', 'DS1']);
    expect(columns.filter((c) => c.live).map((c) => c.label)).toEqual(['DS1']);
  });

  it('ranks teams by round TB, with a column per game and blanks for games not started', () => {
    const [first, second] = roundStandings(1, ['A', 'B', 'C'], games, stats, spells);
    expect(first).toMatchObject({ teamId: 'B', total: 14, rank: 1 });
    expect(Object.fromEntries(first.cells)).toEqual({ F1: 2, F2: 4, F3: null, D1: 8, D2: null, D3: null, D4: null, D5: null });
    expect(second).toMatchObject({ teamId: 'A', total: 6, rank: 2 });
  });

  it('gives tied teams the same rank', () => {
    const ranked = roundStandings(2, ['A', 'B'], games, stats, spells);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("breaks a team's TB down by player and series, keeping what dropped players earned", () => {
    const blocks = teamSeriesBlocks('B', games, stats, spells, (id) => mlbTeam[id]);
    const [wc, ds, cs] = blocks;
    expect(wc.players).toEqual([{ playerId: DEVERS, games: [2, 4, null], total: 6 }]);
    expect(wc.teamGames).toEqual([2, 4, null]);
    // Devers left when the Division Series started; Guerrero joined.
    expect(ds.players).toEqual([{ playerId: GUERRERO, games: [8, null, null, null, null], total: 8 }]);
    expect(ds.total).toBe(8);
    // Series not scheduled yet list the current roster.
    expect(cs.players.map((p) => p.playerId)).toEqual([GUERRERO]);
    expect(roundTotals(blocks)).toEqual({ 1: 14, 2: 0, 3: 0 });
  });

  it("leaves a game blank when the player's team didn't play it", () => {
    const [wc] = teamSeriesBlocks('A', games.slice(0, 2), [], spells, (id) => mlbTeam[id]);
    expect(wc.players[0].games).toEqual([0, 0, null]);
  });

  it('knows the current round', () => {
    expect(currentRound([])).toBe(1);
    expect(currentRound(games)).toBe(1);
    expect(currentRound([...games, { ...games[0], gamePk: 9, gameType: 'L', status: 'Live' }])).toBe(2);
  });
});
