import { describe, expect, it } from 'vitest';

import {
  type ScoreGame,
  currentRound,
  dropKind,
  eliminatedTeams,
  playerSeries,
  playerTotals,
  redraftLock,
  type ScheduledGame,
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

  it("totals each player's TB by round and in all, dropped players included", () => {
    const blocks = teamSeriesBlocks('B', games, stats, spells, (id) => mlbTeam[id]);
    expect(playerTotals(blocks)).toEqual([
      { playerId: DEVERS, rounds: { 1: 6, 2: 0, 3: 0 }, total: 6 },
      { playerId: GUERRERO, rounds: { 1: 8, 2: 0, 3: 0 }, total: 8 },
    ]);
  });

  it('tells a burned drop from one whose MLB team was out', () => {
    const dropped = '2026-10-04T22:00:00Z';
    const live = { eliminated: false, onPostseasonRoster: true };
    // NYY plays the DS after the drop: burned, even once it's out.
    expect(dropKind(dropped, 147, games, { ...live, eliminated: true })).toBe('burned');
    // BOS was out after the Wild Card: out.
    expect(dropKind(dropped, 111, games, { ...live, eliminated: true })).toBe('out');
    // Still alive with no game yet: burned.
    expect(dropKind(dropped, 111, games, live)).toBe('burned');
    // Off his team's postseason roster: out.
    expect(dropKind(dropped, 147, games, { ...live, onPostseasonRoster: false })).toBe('out');
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
  it('redraftLock: the series’ first pitch, once the round before is decided and the time is set', () => {
    const at = (start: string, tbd = false) => (g: SeriesGame): ScheduledGame => ({ ...g, start, startTimeTbd: tbd });
    const wildCard = [
      ...series('F', [1, 9], 'WW', 3),
      ...series('F', [2, 10], 'LWW', 3),
      ...series('F', [3, 11], 'WW', 3),
    ].map(at('2026-09-30T18:00:00Z'));
    const lastWildCard = (results: string) => series('F', [4, 12], results, 3).map(at('2026-10-01T18:00:00Z'));
    const ds = [
      at('2026-10-04T22:08:00Z')(series('D', [1, 5], '', 5, 1)[0]),
      at('2026-10-04T18:08:00Z')(series('D', [2, 6], '', 5, 1)[0]),
    ];
    // A Wild Card still going: a Division Series could still be missing from the schedule.
    expect(redraftLock('D', [...wildCard, ...lastWildCard('WL'), ...ds])).toBeNull();
    expect(redraftLock('D', [...wildCard, ...lastWildCard('WLW'), ...ds])).toBe('2026-10-04T18:08:00Z');
    // The earliest game's time not set yet: wait.
    const tbd = at('2026-10-04T07:33:00Z', true)(series('D', [3, 7], '', 5, 1)[0]);
    expect(redraftLock('D', [...wildCard, ...lastWildCard('WLW'), ...ds, tbd])).toBeNull();
    // Draft 1 isn't a redraft (sync-pool sets its lock).
    expect(redraftLock('F', wildCard)).toBeNull();
  });

  it('eliminatedTeams: each decided series’ loser, as soon as it’s clinched', () => {
    // 9 loses its Wild Card in 2; 3 and 10 are 1–1; the Division Series 1–2 is a sweep so far.
    const games = [...series('F', [1, 9], 'WW', 3), ...series('F', [3, 10], 'LW', 3, 1), ...series('D', [1, 2], 'WWW', 5, 2)];
    expect(eliminatedTeams(games).sort((a, b) => a - b)).toEqual([2, 9]);
    // Home and away swap within a series; a live game doesn't decide anything.
    const swapped: SeriesGame[] = [
      ...series('F', [3, 10], 'W', 3),
      ...series('F', [10, 3], 'W', 3),
      { gameType: 'F', homeTeamId: 3, awayTeamId: 10, status: 'Live', homeScore: 4, awayScore: 1, gamesInSeries: 3 },
    ];
    expect(eliminatedTeams(swapped)).toEqual([]);
    expect(eliminatedTeams([...swapped.slice(0, 2), ...series('F', [3, 10], 'W', 3)])).toEqual([10]);
  });
});

describe('playerSeries', () => {
  it('gives his TB in each started game of his team, a series at a time, with whose roster he was on', () => {
    expect(playerSeries(JUDGE, 147, games, stats, spells)).toEqual([
      {
        gameType: 'F',
        label: 'WC',
        name: 'Wild Card',
        length: 3,
        games: [
          { number: 1, tb: 5, live: false, teamId: 'A', dropped: false },
          { number: 2, tb: 0, live: false, teamId: 'A', dropped: false },
        ],
        total: 5,
      },
      {
        gameType: 'D',
        label: 'DS',
        name: 'Division Series',
        length: 5,
        // Game 2 hasn't started.
        games: [{ number: 1, tb: 1, live: true, teamId: 'A', dropped: false }],
        total: 1,
      },
    ]);
  });

  it('shows games before he was drafted with no team, so they counted for no one', () => {
    const series = playerSeries(GUERRERO, 141, games, stats, spells);
    expect(series.map((s) => s.games)).toEqual([[{ number: 1, tb: 8, live: true, teamId: 'B', dropped: false }]]);
    const late = playerSeries(GUERRERO, 141, games, stats, [{ ...spells[2], from: '2026-10-05T00:00:00Z' }]);
    expect(late[0].games[0].teamId).toBeNull();
  });

  it('keeps his dropped team’s games with the team that had him', () => {
    expect(playerSeries(DEVERS, 111, games, stats, spells).map((s) => s.games.map((g) => g.teamId))).toEqual([['B', 'B']]);
  });

  it('tells games after he was dropped from games before he was drafted', () => {
    // Judge on team A until after the Wild Card, then dropped: the Division Series game is his team's
    // without him on any roster.
    const dropped = playerSeries(JUDGE, 147, games, stats, [{ teamId: 'A', playerId: JUDGE, from: '2026-09-28T00:00:00Z', to: '2026-10-02T00:00:00Z' }]);
    expect(dropped.map((s) => s.games.map((g) => [g.teamId, g.dropped]))).toEqual([
      [['A', false], ['A', false]],
      [[null, true]],
    ]);
    // Not drafted until after his first game: that one is undrafted, not dropped.
    const late = playerSeries(GUERRERO, 141, games, stats, [{ ...spells[2], from: '2026-10-05T00:00:00Z' }]);
    expect(late[0].games[0]).toMatchObject({ teamId: null, dropped: false });
  });

  it('marks games his team played without him', () => {
    const benched = playerSeries(JUDGE, 147, games, stats.filter((s) => !(s.gamePk === 2 && s.playerId === JUDGE)), spells);
    expect(benched[0].games[1]).toEqual({ number: 2, tb: null, live: false, teamId: 'A', dropped: false });
    expect(benched[0].total).toBe(5);
  });

  it('is empty before his team plays', () => {
    expect(playerSeries(JUDGE, 147, games.map((g) => ({ ...g, status: 'Preview' })), stats, spells)).toEqual([]);
  });
});
