import { describe, expect, it } from 'vitest';

import {
  type Counts,
  type PlayerGame,
  emptyCounts,
  formatRate,
  lastGames,
  rates,
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
