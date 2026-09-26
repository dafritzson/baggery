import { describe, expect, it } from 'vitest';

import {
  type Counts,
  type PlayerGame,
  SEASON_RATE_WARMUP,
  absences,
  addDays,
  chartPoints,
  dayPositions,
  daysBetween,
  emptyCounts,
  formatRate,
  lastGames,
  rates,
  seasonLine,
  sumCounts,
} from '../supabase/functions/_shared/core/player-stats.ts';

function game(date: string, c: Partial<Counts>): PlayerGame {
  return { ...emptyCounts(), g: 1, date, opponent: 'BOS', home: true, ...c };
}

describe('player stats', () => {
  // Newest first, as the player-stats function returns them.
  const games = [
    game('2026-09-20', { pa: 5, ab: 4, h: 2, hr: 1, tb: 5, bb: 1 }),
    game('2026-09-19', { pa: 4, ab: 4, h: 0, so: 2 }),
    game('2026-09-18', { pa: 4, ab: 3, h: 1, doubles: 1, tb: 2, sf: 1 }),
  ];

  it('sums counts', () => {
    const total = sumCounts(games);
    expect(total).toMatchObject({ g: 3, pa: 13, ab: 11, h: 3, doubles: 1, hr: 1, tb: 7, bb: 1, so: 2, sf: 1 });
  });

  it('totals the latest n games', () => {
    expect(lastGames(games, 2)).toMatchObject({ g: 2, ab: 8, h: 2, tb: 5 });
    expect(lastGames(games, 30)).toMatchObject({ g: 3 });
  });

  it('computes AVG/OBP/SLG/OPS', () => {
    const r = rates(sumCounts(games));
    expect(r.avg).toBeCloseTo(3 / 11);
    expect(r.obp).toBeCloseTo(4 / 13); // (H + BB + HBP) / (AB + BB + HBP + SF)
    expect(r.slg).toBeCloseTo(7 / 11);
    expect(r.ops).toBeCloseTo(4 / 13 + 7 / 11);
  });

  it('has no rates without at-bats', () => {
    expect(rates(emptyCounts())).toEqual({ avg: null, obp: null, slg: null, ops: null });
    expect(rates({ ...emptyCounts(), pa: 1, bb: 1 })).toMatchObject({ avg: null, obp: 1, slg: null, ops: null });
  });

  it('formats rates like a box score', () => {
    expect(formatRate(0.3125)).toBe('.313');
    expect(formatRate(1.0449)).toBe('1.045');
    expect(formatRate(null)).toBe('—');
  });
});

describe('chart points', () => {
  // Newest first, as the player-stats function returns them.
  const games = [
    game('2026-09-20', { ab: 4, h: 2, tb: 5 }),
    game('2026-09-19', { ab: 4, h: 0 }),
    game('2026-09-18', { ab: 0, bb: 2 }),
  ];

  it('gives counting stats game by game, oldest first', () => {
    expect(chartPoints(games, 'tb', null).map((p) => [p.game.date, p.value])).toEqual([
      ['2026-09-18', 0],
      ['2026-09-19', 0],
      ['2026-09-20', 5],
    ]);
  });

  it('keeps only the latest n games', () => {
    expect(chartPoints(games, 'h', 2).map((p) => p.game.date)).toEqual(['2026-09-19', '2026-09-20']);
    expect(chartPoints(games, 'h', 30)).toHaveLength(3);
  });

  it('runs rates from the first game shown', () => {
    const avg = chartPoints(games, 'avg', null).map((p) => p.value);
    expect(avg[0]).toBeNull(); // no at-bats yet
    expect(avg[1]).toBe(0);
    expect(avg[2]).toBeCloseTo(2 / 8);
    expect(chartPoints(games, 'slg', 1)[0].value).toBeCloseTo(5 / 4);
  });

  it('runs totals for counting stats', () => {
    expect(chartPoints(games, 'tb', null, { total: true }).map((p) => p.value)).toEqual([0, 0, 5]);
    expect(chartPoints(games, 'h', 2, { total: true }).map((p) => p.value)).toEqual([0, 2]);
  });

  it('leaves the first games off the season rate line, but counts them', () => {
    // 15 games, newest first: 1-for-4 in each, except 4-for-4 on opening day.
    const season = Array.from({ length: 15 }, (_, i) =>
      game(`2026-04-${String(15 - i).padStart(2, '0')}`, { ab: 4, h: i === 14 ? 4 : 1 }),
    );
    const points = chartPoints(season, 'avg', null);
    expect(points).toHaveLength(15 - SEASON_RATE_WARMUP);
    expect(points[0].game.date).toBe('2026-04-11');
    expect(points[0].value).toBeCloseTo(14 / 44);
    expect(points.at(-1)!.value).toBeCloseTo(18 / 60);
    // A last-N window keeps every game, and a short season isn't cut.
    expect(chartPoints(season, 'avg', 15)).toHaveLength(15);
    expect(chartPoints(season.slice(0, 8), 'avg', null)).toHaveLength(8);
  });
});

describe('season calendar', () => {
  it('counts days between dates', () => {
    expect(daysBetween('2026-03-25', '2026-03-25')).toBe(0);
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
    expect(daysBetween('2026-04-01', '2026-03-25')).toBe(-7);
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // no daylight-saving slip
  });

  it('puts each game in the middle of its day, and splits a doubleheader', () => {
    const points = chartPoints(
      [game('2026-03-27', {}), game('2026-03-26', {}), game('2026-03-26', {}), game('2026-03-25', {})],
      'tb',
      null,
    );
    expect(dayPositions(points, '2026-03-25')).toEqual([0.5, 1.25, 1.75, 2.5]);
  });

  it('finds long stretches without a game, including before his first and since his last', () => {
    const games = [game('2026-09-16', {}), game('2026-09-11', {}), game('2026-06-05', {}), game('2026-04-10', {})];
    expect(absences(games, '2026-03-25', '2026-09-26')).toEqual([
      { from: '2026-03-25', to: '2026-04-09', days: 16 },
      { from: '2026-04-11', to: '2026-06-04', days: 55 },
      { from: '2026-06-06', to: '2026-09-10', days: 97 },
      { from: '2026-09-17', to: '2026-09-26', days: 10 },
    ]);
    // Nine days off (the All-Star break and then some) doesn't count.
    expect(absences([game('2026-07-20', {}), game('2026-07-10', {})], '2026-07-10', '2026-07-20')).toEqual([]);
    expect(absences([], '2026-09-01', '2026-09-10')).toEqual([{ from: '2026-09-01', to: '2026-09-10', days: 10 }]);
  });

  it('holds a running total flat through days off, from 0 on opening day to the end', () => {
    // Newest first: 2 TB on 3/27, then 3 TB after five days off.
    const games = [game('2026-04-02', { tb: 3 }), game('2026-03-27', { tb: 2 })];
    const points = chartPoints(games, 'tb', null, { total: true });
    expect(seasonLine(points, '2026-03-25', '2026-04-05', { fromZero: true })).toEqual([
      [0, 0],
      [1.5, 0], // flat until the day before his first game
      [2.5, 2],
      [7.5, 2], // flat through the days off
      [8.5, 5],
      [12, 5], // and on to the end of the last day
    ]);
  });

  it('starts a rate line at its first value', () => {
    const games = [game('2026-03-26', { ab: 4, h: 1 }), game('2026-03-25', { bb: 1 })];
    const line = seasonLine(chartPoints(games, 'avg', null), '2026-03-25', '2026-03-26');
    expect(line).toEqual([
      [1.5, 0.25],
      [2, 0.25],
    ]);
  });
});
