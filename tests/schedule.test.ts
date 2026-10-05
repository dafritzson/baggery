import { describe, expect, it } from 'vitest';

import { type ScheduleGame, ifNecessary, neededGames, notNeeded, postseasonSeries, recordBefore, seriesLine } from '../supabase/functions/_shared/core/schedule.ts';

const NYY = 147;
const BOS = 111;
const TOR = 141;
const SEA = 136;

let pk = 0;
function game(over: Partial<ScheduleGame> & Pick<ScheduleGame, 'gameType' | 'seriesGameNumber' | 'homeTeamId' | 'awayTeamId'>): ScheduleGame {
  return {
    gamePk: ++pk,
    start: `2026-10-0${over.seriesGameNumber}T22:00:00Z`,
    status: 'Final',
    homeScore: null,
    awayScore: null,
    gamesInSeries: null,
    ...over,
  };
}

describe('postseasonSeries', () => {
  it('groups games by round and matchup, whoever is home', () => {
    const series = postseasonSeries([
      game({ gameType: 'D', seriesGameNumber: 1, homeTeamId: TOR, awayTeamId: NYY, homeScore: 3, awayScore: 5 }),
      game({ gameType: 'D', seriesGameNumber: 2, homeTeamId: TOR, awayTeamId: NYY, homeScore: 6, awayScore: 1 }),
      game({ gameType: 'D', seriesGameNumber: 3, homeTeamId: NYY, awayTeamId: TOR, homeScore: 2, awayScore: 0 }),
      game({ gameType: 'D', seriesGameNumber: 1, homeTeamId: SEA, awayTeamId: BOS, status: 'Preview' }),
    ]);
    expect(series.map((s) => s.key)).toEqual(['D:141-147', 'D:111-136']);
    const [nyyTor] = series;
    // Game 1's home team first.
    expect(nyyTor.teams).toEqual([TOR, NYY]);
    expect(nyyTor.wins).toEqual([1, 2]);
    expect(nyyTor.winner).toBeNull();
    expect(nyyTor.bestOf).toBe(5);
    expect(nyyTor.games.map((g) => g?.seriesGameNumber)).toEqual([1, 2, 3, undefined, undefined]);
  });

  it('puts the rounds in play order, then each round by its first pitch', () => {
    const series = postseasonSeries([
      game({ gameType: 'W', seriesGameNumber: 1, homeTeamId: NYY, awayTeamId: SEA }),
      game({ gameType: 'F', seriesGameNumber: 1, homeTeamId: TOR, awayTeamId: BOS, start: '2026-09-30T20:00:00Z' }),
      game({ gameType: 'F', seriesGameNumber: 1, homeTeamId: NYY, awayTeamId: SEA, start: '2026-09-30T17:00:00Z' }),
    ]);
    expect(series.map((s) => s.key)).toEqual(['F:136-147', 'F:111-141', 'W:136-147']);
  });

  it('knows the winner and which games the series no longer needs', () => {
    const [ws] = postseasonSeries([
      game({ gameType: 'W', seriesGameNumber: 1, homeTeamId: NYY, awayTeamId: SEA, homeScore: 4, awayScore: 1 }),
      game({ gameType: 'W', seriesGameNumber: 2, homeTeamId: NYY, awayTeamId: SEA, homeScore: 4, awayScore: 2 }),
      game({ gameType: 'W', seriesGameNumber: 3, homeTeamId: SEA, awayTeamId: NYY, homeScore: 0, awayScore: 3 }),
      game({ gameType: 'W', seriesGameNumber: 4, homeTeamId: SEA, awayTeamId: NYY, homeScore: 1, awayScore: 2 }),
      game({ gameType: 'W', seriesGameNumber: 5, homeTeamId: SEA, awayTeamId: NYY, status: 'Preview' }),
    ]);
    expect(ws.wins).toEqual([4, 0]);
    expect(ws.winner).toBe(NYY);
    expect([4, 5, 6].map((n) => notNeeded(ws, n))).toEqual([false, true, true]);
    expect([4, 5].map((n) => ifNecessary(ws, n))).toEqual([false, true]);
  });

  it('leaves out the games a decided series no longer needs', () => {
    const games = [
      game({ gameType: 'F', seriesGameNumber: 1, homeTeamId: NYY, awayTeamId: SEA, homeScore: 4, awayScore: 1 }),
      game({ gameType: 'F', seriesGameNumber: 2, homeTeamId: SEA, awayTeamId: NYY, homeScore: 0, awayScore: 3 }),
      game({ gameType: 'F', seriesGameNumber: 3, homeTeamId: SEA, awayTeamId: NYY, status: 'Preview' }),
      game({ gameType: 'F', seriesGameNumber: 1, homeTeamId: TOR, awayTeamId: BOS, homeScore: 2, awayScore: 1 }),
      game({ gameType: 'F', seriesGameNumber: 2, homeTeamId: BOS, awayTeamId: TOR, status: 'Preview' }),
    ];
    expect(neededGames(games).map((g) => g.gamePk)).toEqual([games[0], games[1], games[3], games[4]].map((g) => g.gamePk));
  });

  it("takes the series length from MLB (2021's one-game Wild Card)", () => {
    const [wc] = postseasonSeries([game({ gameType: 'F', seriesGameNumber: 1, homeTeamId: NYY, awayTeamId: BOS, gamesInSeries: 1, homeScore: 2, awayScore: 6 })]);
    expect(wc.bestOf).toBe(1);
    expect(wc.winner).toBe(BOS);
  });

  it('still counts a game MLB lists past the usual series length', () => {
    const [wc] = postseasonSeries([game({ gameType: 'F', seriesGameNumber: 4, homeTeamId: NYY, awayTeamId: BOS, status: 'Preview' })]);
    expect(wc.bestOf).toBe(4);
    expect(wc.games[3]?.seriesGameNumber).toBe(4);
  });
});

describe('seriesLine', () => {
  const games = (results: [number, number][]) =>
    results.map(([home, away], i) => game({ gameType: 'D', seriesGameNumber: i + 1, homeTeamId: TOR, awayTeamId: NYY, homeScore: home, awayScore: away }));

  it('says it from the team\'s own side', () => {
    // TOR won game 1, NYY won game 2 and 3.
    const [series] = postseasonSeries(games([[3, 1], [0, 2], [1, 4]]));
    expect(seriesLine(series, NYY)).toBe('leads 2–1');
    expect(seriesLine(series, TOR)).toBe('trails 1–2');
  });

  it('is tied, not started, won or lost', () => {
    expect(seriesLine(postseasonSeries(games([[3, 1], [0, 2]]))[0], TOR)).toBe('tied 1–1');
    const [fresh] = postseasonSeries([game({ gameType: 'D', seriesGameNumber: 1, homeTeamId: TOR, awayTeamId: NYY, status: 'Preview' })]);
    expect(seriesLine(fresh, NYY)).toBe('0–0');
    const [done] = postseasonSeries(games([[3, 1], [0, 2], [1, 4], [0, 5]]));
    expect(seriesLine(done, NYY)).toBe('won 3–1');
    expect(seriesLine(done, TOR)).toBe('lost 1–3');
  });
});

describe('recordBefore', () => {
  it("counts only the series' earlier games, from each team's side", () => {
    const games = [
      game({ gameType: 'D', seriesGameNumber: 1, homeTeamId: TOR, awayTeamId: NYY, homeScore: 3, awayScore: 1 }),
      game({ gameType: 'D', seriesGameNumber: 2, homeTeamId: TOR, awayTeamId: NYY, homeScore: 0, awayScore: 2 }),
      game({ gameType: 'D', seriesGameNumber: 3, homeTeamId: NYY, awayTeamId: TOR, homeScore: 5, awayScore: 4 }),
      game({ gameType: 'D', seriesGameNumber: 4, homeTeamId: NYY, awayTeamId: TOR, status: 'Preview' }),
      // Another series' game doesn't count.
      game({ gameType: 'D', seriesGameNumber: 1, homeTeamId: SEA, awayTeamId: BOS, homeScore: 1, awayScore: 0 }),
    ];
    const before4 = recordBefore(games, games[3]);
    expect(before4.get(NYY)).toEqual([2, 1]);
    expect(before4.get(TOR)).toEqual([1, 2]);
    // Game 3's record leaves out game 3 itself.
    expect(recordBefore(games, games[2]).get(NYY)).toEqual([1, 1]);
    expect(recordBefore(games, games[0]).get(TOR)).toEqual([0, 0]);
  });
});
