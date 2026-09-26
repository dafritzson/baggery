import { describe, expect, it } from 'vitest';

import { type ScheduleGame, ifNecessary, notNeeded, postseasonSeries } from '../supabase/functions/_shared/core/schedule.ts';

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
