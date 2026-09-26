import { describe, expect, it } from 'vitest';

import {
  type ScoreGame,
  currentRound,
  roundColumns,
  roundDecided,
  roundStandings,
  type SeriesGame,
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

  it('breaks a tie on TB with the rules: higher slugging first', () => {
    // Both teams have 5 TB in the Wild Card; A needed 4 at-bats, B 5, so A ranks ahead.
    const tied = [
      { gamePk: 1, playerId: JUDGE, tb: 5, ab: 4, h: 2 },
      { gamePk: 1, playerId: DEVERS, tb: 5, ab: 5, h: 2 },
    ];
    const [first, second] = roundStandings(1, ['B', 'A'], games, tied, spells);
    expect([first.teamId, first.rank, second.teamId, second.rank]).toEqual(['A', 1, 'B', 2]);
    expect(first.totals).toMatchObject({ tb: 5, ab: 4, h: 2 });
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

describe('roundDecided', () => {
  // A best-of-n series between two teams, from the home team's results ('W'/'L'), with any
  // leftover games still scheduled.
  const series = (gameType: SeriesGame['gameType'], teams: [number, number], results: string, length: number, leftover = 0): SeriesGame[] => [
    ...[...results].map((r) => ({
      gameType, homeTeamId: teams[0], awayTeamId: teams[1], status: 'Final',
      homeScore: r === 'W' ? 5 : 2, awayScore: r === 'W' ? 2 : 5, gamesInSeries: length,
    })),
    ...Array.from({ length: leftover }, () => ({
      gameType, homeTeamId: teams[0], awayTeamId: teams[1], status: 'Preview', homeScore: null, awayScore: null, gamesInSeries: length,
    })),
  ];
  const divisionSeries = (last: string) => [
    ...series('D', [1, 2], 'WWW', 5, 2), // a sweep, with games 4 and 5 still listed "if necessary"
    ...series('D', [3, 4], 'WLWW', 5),
    ...series('D', [5, 6], 'LLL', 5),
    ...series('D', [7, 8], last, 5),
  ];

  it('is decided when every series has a winner, leftover games or not', () => {
    const wildCard = [...series('F', [1, 9], 'WW', 3), ...series('F', [3, 10], 'LWW', 3)];
    expect(roundDecided(1, [...wildCard, ...divisionSeries('WLWLW')])).toBe(true);
  });

  it('isn’t while any series is still going', () => {
    expect(roundDecided(1, divisionSeries('WLWL'))).toBe(false);
  });

  it('isn’t while a game is live', () => {
    const games = divisionSeries('WLWLW');
    games[games.length - 1] = { ...games[games.length - 1], status: 'Live' };
    expect(roundDecided(1, games)).toBe(false);
  });

  it('isn’t when only the Wild Card is done and the Division Series aren’t set yet', () => {
    expect(roundDecided(1, [...series('F', [1, 9], 'WW', 3), ...series('F', [3, 10], 'WW', 3)])).toBe(false);
  });

  it('handles 2021’s one-game Wild Card', () => {
    expect(roundDecided(1, [...series('F', [1, 9], 'W', 1), ...series('F', [3, 10], 'L', 1), ...divisionSeries('WWW')])).toBe(true);
  });

  it('needs four wins in a best-of-seven', () => {
    expect(roundDecided(3, series('W', [1, 2], 'WWWLL', 7, 2))).toBe(false);
    expect(roundDecided(3, series('W', [1, 2], 'WWWLLW', 7, 1))).toBe(true);
  });
});
